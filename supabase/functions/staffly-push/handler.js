// Staffly push sender - core logic (runtime-neutral, tested outside Deno).
// index.ts injects the web-push library and the service-role RPC caller.
//
// Called by the database (pg_net) with { action: 'send', notification_id }.
// It CLAIMS the notification first (svc_push_claim marks it pushed and only
// works once, within 10 minutes), so this endpoint needs no secret: calling
// it with an old or already-sent id does nothing.

const PAGE_FOR_KIND = {
  leave_applied: '/?view=leaveView&tab=review',
  leave_decided: '/?view=leaveView&tab=mine',
  punch_in: '/?view=directoryView',
  punch_in_self: '/'
};

export function createPushHandler({ webpush, rpc, publicKey, privateKey, subject }) {
  const configured = !!(publicKey && privateKey);
  if (configured) webpush.setVapidDetails(subject, publicKey, privateKey);

  return async function handle(body) {
    const action = body && body.action;

    // The app needs the PUBLIC key to subscribe a device. Safe to share.
    if (action === 'public-key') {
      if (!configured) throw new Error('NOT_CONFIGURED');
      return { status: 'OK', publicKey };
    }

    if (action === 'send') {
      if (!configured) throw new Error('NOT_CONFIGURED');
      const id = Number(body.notification_id);
      if (!Number.isInteger(id) || id <= 0) throw new Error('BAD_ID');

      const n = await rpc('svc_push_claim', { p_id: id });
      if (!n) return { status: 'SKIPPED' }; // unknown, already sent, or too old

      const payload = JSON.stringify({
        title: n.title,
        body: n.body || '',
        tag: `${n.kind}-${n.id}`,
        kind: n.kind,
        url: PAGE_FOR_KIND[n.kind] || '/'
      });

      let sent = 0, removed = 0, failed = 0;
      await Promise.all((n.subscriptions || []).map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            { TTL: 60 * 60, urgency: 'high' }
          );
          sent++;
          await rpc('svc_push_result', { p_endpoint: s.endpoint, p_ok: true, p_gone: false }).catch(() => {});
        } catch (e) {
          // 404 / 410 = the device unsubscribed or was reset: forget it.
          const gone = e && (e.statusCode === 404 || e.statusCode === 410);
          if (gone) removed++; else failed++;
          await rpc('svc_push_result', { p_endpoint: s.endpoint, p_ok: false, p_gone: !!gone }).catch(() => {});
        }
      }));
      return { status: 'OK', sent, removed, failed };
    }

    throw new Error('UNKNOWN_ACTION');
  };
}
