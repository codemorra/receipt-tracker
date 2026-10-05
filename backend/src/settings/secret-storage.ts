import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  constants,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  lstatSync,
  writeFileSync,
  fsyncSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import type { ProviderId } from "./provider-settings.js";

// Error class for secret storage-related issues.
export class SecretStorageError extends Error {
  constructor(
    public readonly code: "secret_key_unavailable" | "secret_decryption_failed",
  ) {
    super(
      code === "secret_key_unavailable"
        ? "The local secret master key is missing, inaccessible, or unsafe. Restore the key before using stored API keys."
        : "The stored API key cannot be decrypted with the local master key.",
    );
    this.name = "SecretStorageError";
  }
}

// Schema for validating the structure of encrypted data envelopes.
const envelopeSchema = z
  .object({
    version: z.literal(1),
    nonce: z.string(),
    tag: z.string(),
    ciphertext: z.string(),
  })
  .strict();

/**
 * Determines the default directory for storing the local master key.
 * @param env The environment variables to consider (defaults to process.env).
 * @returns The absolute path to the default secret key directory.
 * @throws {SecretStorageError} If the resolved directory is not absolute.
 */
export function defaultSecretKeyDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const directory =
    env.SECRETS_KEY_DIR ??
    join(
      env.XDG_CONFIG_HOME || join(homedir(), ".config"),
      "receipt-tracker",
      "keys",
    );
  if (!isAbsolute(directory))
    throw new SecretStorageError("secret_key_unavailable");
  return directory;
}

/**
 * Service for managing secret storage.
 * Handles the local master key and provides encryption/decryption capabilities for API keys.
 * Stores only one local master key. Existing ciphertext never permits automatic key replacement.
 */
export class SecretStorage {
  constructor(private readonly directory = defaultSecretKeyDirectory()) {}

  /**
   * Loads the local master key from the secure storage.
   * @param allowCreate Whether to allow creating the key if it doesn't exist.
   * @returns The 32-byte master key.
   * @throws {SecretStorageError} If the key is unavailable or cannot be loaded securely.
   */
  private loadKey(allowCreate: boolean): Buffer {
    let descriptor: number | undefined;
    try {
      if (!isAbsolute(this.directory)) throw new Error();
      if (allowCreate)
        mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const directoryStat = lstatSync(this.directory);
      if (
        !directoryStat.isDirectory() ||
        (process.platform !== "win32" &&
          ((directoryStat.mode & 0o077) !== 0 ||
            directoryStat.uid !== process.getuid?.()))
      ) {
        throw new Error();
      }
      const path = join(this.directory, "master.key");
      if (allowCreate) {
        try {
          descriptor = openSync(
            path,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
            0o600,
          );
          writeFileSync(descriptor, randomBytes(32));
          fsyncSync(descriptor);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        } finally {
          if (descriptor !== undefined) closeSync(descriptor);
          descriptor = undefined;
        }
      }
      descriptor = openSync(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      const fileStat = fstatSync(descriptor);
      if (
        !fileStat.isFile() ||
        fileStat.size !== 32 ||
        (process.platform !== "win32" &&
          ((fileStat.mode & 0o077) !== 0 ||
            fileStat.uid !== process.getuid?.()))
      ) {
        throw new Error();
      }
      const key = readFileSync(descriptor);
      if (key.length !== 32) throw new Error();
      return key;
    } catch {
      throw new SecretStorageError("secret_key_unavailable");
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  /**
   * Encrypts a value for the specified provider using the local master key.
   * @param provider The provider identifier.
   * @param value The plaintext value to encrypt.
   * @param hasExistingSecrets Whether there are existing secrets that require the key to already exist.
   * @returns The encrypted value as a JSON string.
   * @throws {SecretStorageError} If the encryption fails.
   */
  encrypt(
    provider: ProviderId,
    value: string,
    hasExistingSecrets: boolean,
  ): string {
    const key = this.loadKey(!hasExistingSecrets);
    try {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(Buffer.from(`receipt-tracker:${provider}:1`));
      const ciphertext = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      return JSON.stringify({
        version: 1,
        nonce: nonce.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      });
    } finally {
      key.fill(0);
    }
  }

  /**
   * Decrypts an encrypted value for the specified provider using the local master key.
   * @param provider The provider identifier.
   * @param encrypted The encrypted value as a JSON string.
   * @returns The decrypted plaintext value.
   * @throws {SecretStorageError} If the decryption fails.
   */
  decrypt(provider: ProviderId, encrypted: string): string {
    const key = this.loadKey(false);
    try {
      const envelope = envelopeSchema.parse(JSON.parse(encrypted));
      const nonce = Buffer.from(envelope.nonce, "base64");
      const tag = Buffer.from(envelope.tag, "base64");
      if (nonce.length !== 12 || tag.length !== 16) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(Buffer.from(`receipt-tracker:${provider}:1`));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new SecretStorageError("secret_decryption_failed");
    } finally {
      key.fill(0);
    }
  }
}
