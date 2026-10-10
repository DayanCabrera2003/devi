// Tipos compartidos entre el hub, el MCP y la ventana de Devi.

export type Member = {
  id: string;
  name: string;
  role: string;
  description: string;
};

export type SessionStatus = "idle" | "working";

export type Session = {
  id: string;
  user: string;
  name: string;
  status: SessionStatus;
};

export type RequestStatus =
  | "pending"
  | "forwarded"
  | "accepted"
  | "rejected"
  | "answered"
  | "timed_out"
  | "closed";

export type DeviRequest = {
  id: string;
  from: string;
  fromSessionId: string;
  fromSessionName: string;
  to: string;
  message: string;
  status: RequestStatus;
  forwardedSessionId?: string;
  outcome?: "accepted" | "rejected" | "answered"; // se conserva aunque A cierre la respuesta
  outcomeText?: string; // nota de aceptar, motivo de rechazo o respuesta de la sesión
  createdAt: number;
  deadline: number;
};

// Lo que el hub empuja a una sesión (el MCP lo convierte en un evento de channel).
export type SessionDelivery = {
  kind: "request" | "response" | "debug";
  content: string;
  meta: Record<string, string>;
};
