import type { Scan, ProcessedScan } from "../api/scan-api";
import type { Corners, Rotation } from "./scan-orientation";
import { addRotation, rotateCorners } from "./scan-orientation.ts";
import type { AiSettings, ProviderId } from "../api/provider-settings-api";

/**
 * Resolves the import provider based on the user's selection and available settings.
 * @param settings - The AI settings containing available providers.
 * @param selection - The user's selected provider ID.
 * @returns The resolved provider ID or null if no valid provider is found.
 */
export function resolveImportProvider(
  settings: AiSettings | null,
  selection: ProviderId | null | undefined,
): ProviderId | null {
  const requested =
    selection === undefined ? (settings?.defaultProvider ?? null) : selection;
  return settings?.providers.some(
    (provider) => provider.provider === requested && provider.selectable,
  )
    ? requested
    : null;
}

// Defines the state and actions for the receipt import workflow.
export interface ImportState {
  file: File | null;
  scan: Scan | null;
  corners: Corners | null;
  rotation: Rotation;
  processed: ProcessedScan | null;
  generation: number;
  busy: "upload" | "process" | "delete" | null;
}

// Initial state for the receipt import workflow.
export const initialImportState: ImportState = {
  file: null,
  scan: null,
  corners: null,
  rotation: 0,
  processed: null,
  generation: 0,
  busy: null,
};

// Defines the possible actions for the receipt import workflow.
export type ImportAction =
  | { type: "file"; file: File }
  | { type: "start"; operation: NonNullable<ImportState["busy"]> }
  | { type: "uploaded"; scan: Scan }
  | { type: "corners"; corners: Corners }
  | { type: "receipt-frame" }
  | { type: "rotate"; turn: Rotation }
  | { type: "processed"; result: ProcessedScan }
  | { type: "settled" }
  | { type: "reset" };

/**
 * Reducer function for managing the receipt import workflow state.
 * @param state - The current import state.
 * @param action - The action to be applied to the state.
 * @returns The updated import state after applying the action.
 */
export function importReducer(
  state: ImportState,
  action: ImportAction,
): ImportState {
  switch (action.type) {
    case "file":
      return state.busy || state.scan
        ? state
        : {
            ...initialImportState,
            file: action.file,
            generation: state.generation + 1,
          };
    case "start":
      return {
        ...state,
        busy: action.operation,
        ...(action.operation === "process"
          ? { processed: null, generation: state.generation + 1 }
          : {}),
      };
    case "uploaded":
      return {
        ...state,
        scan: action.scan,
        corners: action.scan.suggestedCorners,
        rotation: action.scan.rotation,
        processed: null,
      };
    case "corners":
      return state.busy
        ? state
        : {
            ...state,
            corners: action.corners,
            processed: null,
            generation: state.generation + 1,
          };
    case "rotate":
      return state.busy || !state.corners
        ? state
        : {
            ...state,
            corners: rotateCorners(state.corners, action.turn),
            rotation: addRotation(state.rotation, action.turn),
            processed: null,
            generation: state.generation + 1,
          };
    case "receipt-frame":
      return state.busy || !state.scan
        ? state
        : {
            ...state,
            corners: rotateCorners(
              state.scan.suggestedCorners,
              ((state.rotation - state.scan.rotation + 360) % 360) as Rotation,
            ),
            processed: null,
            generation: state.generation + 1,
          };
    case "processed":
      return { ...state, processed: action.result };
    case "settled":
      return { ...state, busy: null };
    case "reset":
      return { ...initialImportState, generation: state.generation + 1 };
  }
}
