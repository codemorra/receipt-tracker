import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  uploadScan,
  deleteScan,
  processScan,
  validateScanFile,
  ScanApiError,
  type ScanErrorCode,
} from "../api/scan-api";
import { ImportRequestScope } from "../scans/import-lifecycle";
import type { ProviderId } from "../api/provider-settings-api";
import {
  importReducer,
  initialImportState,
  type ImportState,
} from "../scans/import-state";

/**
 * Custom hook for managing the receipt import process, including file selection, upload, processing, and error handling.
 * @returns An object containing the import state, dispatch function, notice, and various action functions.
 */
export function useReceiptImport() {
  const [state, dispatch] = useReducer(importReducer, initialImportState);
  const [notice, setNotice] = useState<{
    id: number;
    code: ScanErrorCode;
  } | null>(null);
  const noticeId = useRef(0);
  const requests = useRef(new ImportRequestScope());
  const cancelling = useRef(false);
  const [discarding, setDiscarding] = useState(false);
  useEffect(() => {
    const scope = requests.current;
    return () => scope.abort();
  }, []);
  const reportError = useCallback(
    (code: ScanErrorCode) => setNotice({ id: ++noticeId.current, code }),
    [],
  );
  const dismissNotice = useCallback(() => setNotice(null), []);

  /**
   * Handles the selection of a new file for import.
   * @param file - The file selected by the user.
   */
  function selectFile(file: File) {
    if (cancelling.current || state.scan) return;
    try {
      validateScanFile(file);
      setNotice(null);
      dispatch({ type: "file", file });
      void createPreview(file);
    } catch (error) {
      reportError(
        error instanceof ScanApiError ? error.code : "unexpected_response",
      );
    }
  }

  /**
   * Runs an asynchronous operation with proper error handling and state management.
   * @param operation - The type of operation being performed.
   * @param action - The asynchronous action to execute.
   */
  async function run(
    operation: NonNullable<ImportState["busy"]>,
    action: (signal: AbortSignal) => Promise<void>,
  ) {
    if (cancelling.current) return;
    const controller = requests.current.begin();
    if (!controller) return;
    setNotice(null);
    dispatch({ type: "start", operation });
    try {
      await action(controller.signal);
    } catch (error) {
      if (requests.current.current(controller))
        reportError(
          error instanceof ScanApiError ? error.code : "unexpected_response",
        );
    } finally {
      if (requests.current.finish(controller)) {
        dispatch({ type: "settled" });
      }
    }
  }

  /**
   * Creates a preview of the selected file by uploading it.
   * @param file - The file to create a preview for.
   * @returns A promise that resolves when the preview is created.
   */
  function createPreview(file: File) {
    return run("upload", async (signal) => {
      const scan = await uploadScan(file, signal);
      if (!signal.aborted) dispatch({ type: "uploaded", scan });
      else await deleteScan(scan.scanId);
    });
  }

  /**
   * Initiates the upload of the selected file.
   * @returns A promise that resolves when the upload is complete.
   */
  function upload() {
    if (!state.file || state.scan) return;
    return createPreview(state.file);
  }

  /**
   * Initiates the processing of the uploaded scan with the specified provider.
   * @param provider - The provider to use for processing the scan.
   * @returns A promise that resolves when the processing is complete.
   */
  function process(provider: ProviderId) {
    if (!state.scan || !state.corners) return;
    const { scan, corners, rotation } = state;
    return run("process", async (signal) => {
      const result = await processScan(
        scan.scanId,
        corners,
        rotation,
        provider,
        signal,
      );
      if (!signal.aborted) dispatch({ type: "processed", result });
    });
  }

  // Function for discarding the current scan and resetting the state.
  async function discard(): Promise<boolean> {
    if (cancelling.current) return false;
    cancelling.current = true;
    setDiscarding(true);
    setNotice(null);
    try {
      await requests.current.discard(state.scan?.scanId ?? null, deleteScan);
      dispatch({ type: "reset" });
      return true;
    } catch (error) {
      reportError(
        error instanceof ScanApiError ? error.code : "scan_cancel_failed",
      );
      dispatch({ type: "settled" });
      return false;
    } finally {
      cancelling.current = false;
      setDiscarding(false);
    }
  }

  return {
    state,
    discarding,
    discard,
    dispatch,
    notice,
    dismissNotice,
    reportError,
    selectFile,
    upload,
    process,
  };
}
