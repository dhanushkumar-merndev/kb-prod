export type BreakKind = "lunch" | "break" | "superfone";

export interface ActiveBreak {
  id: string;
  breakType: BreakKind;
  startedAt: string;
}

export interface SessionSummaryData {
  loginAt: string | null;
  activeBreak: ActiveBreak | null;
}

export interface SessionControlActionState {
  status: "idle" | "success" | "error";
  message: string;
  mutationId: string;
}

export const INITIAL_SESSION_CONTROL_STATE: SessionControlActionState = {
  status: "idle",
  message: "",
  mutationId: "initial",
};
