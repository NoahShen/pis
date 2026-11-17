import type { AdapterReason } from "./contracts.js";

export interface RssTransportRequest {
  kind: "feed" | "article";
  url: string;
  timeoutMs: number;
  maxBytes: number;
}

export interface RssTransportDocument {
  finalUrl: string;
  body: string;
  receivedResponse: true;
}

export interface RssTransport {
  fetch(request: Readonly<RssTransportRequest>): Promise<RssTransportDocument>;
}

export class AcquisitionError extends Error {
  readonly reason: AdapterReason;
  readonly receivedResponse: boolean;
  readonly finalUrl: string | null;

  constructor(
    reason: AdapterReason,
    receivedResponse: boolean,
    finalUrl: string | null,
  ) {
    super("RSS acquisition failed");

    if (receivedResponse && finalUrl === null) {
      throw new RangeError("A received response requires a last validated URL");
    }

    this.name = "AcquisitionError";
    this.reason = reason;
    this.receivedResponse = receivedResponse;
    this.finalUrl = finalUrl;
  }
}
