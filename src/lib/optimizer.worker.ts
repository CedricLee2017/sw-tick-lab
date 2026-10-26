import { optimize, type OptRequest, type OptResult } from "./optimizer";

self.onmessage = (e: MessageEvent<{ id: number; req: OptRequest }>) => {
  const { id, req } = e.data;
  try {
    const res: OptResult = optimize(req);
    // 用 transfer 把 typed array 直接移交給主執行緒，避免複製上百 MB
    (self as unknown as Worker).postMessage({ id, res }, [
      res.runeIds.buffer,
      res.statValues.buffer,
      res.scores.buffer,
      res.effs.buffer,
      res.focusFits.buffer,
      res.order.buffer,
    ]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
