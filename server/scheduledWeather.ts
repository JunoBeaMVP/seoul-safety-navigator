import type { Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { refreshSafetySnapshot } from "./safety";

/** Platform Heartbeat callback. The scheduler is created only after deployment. */
export async function weatherRefreshHandler(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
    const snapshot = await refreshSafetySnapshot();
    return res.json({ ok: true, generatedAt: snapshot.generatedAt, alertCount: snapshot.alerts.length });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "weather-refresh-failed",
      timestamp: new Date().toISOString(),
    });
  }
}
