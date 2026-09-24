// Staffly fingerprint login (WebAuthn / passkeys) - core logic.
// Kept runtime-neutral (no Deno/Node imports) so it can be tested outside
// the Edge Function. index.ts injects the WebAuthn library and the RPC caller.
//
// The fingerprint itself never leaves the phone. The phone signs a one-time
// challenge with a private key locked in its secure chip; we verify the
// signature with the stored PUBLIC key, then issue a normal session token.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64Url(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function newChallenge() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return { bytes: b, b64: toB64Url(b) };
}

// The challenge the browser signed, read from clientDataJSON. It is only
// trusted after it's found (unexpired, right purpose) in our own table.
function challengeFromResponse(resp) {
  const cd = JSON.parse(dec.decode(fromB64Url(resp.response.clientDataJSON)));
  return cd.challenge;
}

export function createHandler({ swa, rpc, rpID, rpName, origins }) {
  return async function handle(body) {
    const action = body && body.action;

    // --- Enable fingerprint: step 1 (needs login token + this phone's secret)
    if (action === 'register-options') {
      const ch = newChallenge();
      const info = await rpc('svc_passkey_register_begin', {
        p_token: body.token, p_device_secret: body.device_secret, p_challenge: ch.b64
      });
      const options = await swa.generateRegistrationOptions({
        rpName, rpID,
        userID: enc.encode(info.employee_id),
        userName: info.employee_id,
        userDisplayName: info.employee_name || info.employee_id,
        challenge: ch.bytes,
        attestationType: 'none',
        excludeCredentials: (info.exclude || []).map(c => ({ id: c.id, transports: c.transports || undefined })),
        authenticatorSelection: {
          authenticatorAttachment: 'platform',   // the phone's own sensor, not a USB key
          residentKey: 'preferred',
          userVerification: 'required'           // must actually scan finger / face / screen lock
        },
        supportedAlgorithmIDs: [-7, -257]
      });
      if (options.challenge !== ch.b64) throw new Error('CHALLENGE_MISMATCH');
      return { status: 'OK', options };
    }

    // --- Enable fingerprint: step 2
    if (action === 'register-verify') {
      const resp = body.response;
      const challenge = challengeFromResponse(resp);
      const pending = await rpc('svc_passkey_challenge', { p_challenge: challenge, p_purpose: 'register' });
      if (!pending) throw new Error('CHALLENGE_INVALID');

      const v = await swa.verifyRegistrationResponse({
        response: resp,
        expectedChallenge: challenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: true
      });
      if (!v.verified || !v.registrationInfo) throw new Error('FINGERPRINT_NOT_VERIFIED');

      const cred = v.registrationInfo.credential;
      await rpc('svc_passkey_register_finish', {
        p_challenge: challenge,
        p_credential_id: cred.id,
        p_public_key: toB64Url(cred.publicKey),
        p_sign_count: cred.counter || 0,
        p_transports: cred.transports || resp.response.transports || null
      });
      return { status: 'OK' };
    }

    // --- Fingerprint login: step 1 (only this phone's secret)
    if (action === 'login-options') {
      const ch = newChallenge();
      const info = await rpc('svc_passkey_login_begin', {
        p_device_secret: body.device_secret, p_challenge: ch.b64
      });
      const options = await swa.generateAuthenticationOptions({
        rpID,
        challenge: ch.bytes,
        allowCredentials: (info.allow || []).map(c => ({ id: c.id, transports: c.transports || undefined })),
        userVerification: 'required'
      });
      if (options.challenge !== ch.b64) throw new Error('CHALLENGE_MISMATCH');
      return { status: 'OK', options };
    }

    // --- Fingerprint login: step 2 -> session token
    if (action === 'login-verify') {
      const resp = body.response;
      const challenge = challengeFromResponse(resp);
      const stored = await rpc('svc_passkey_login_lookup', { p_challenge: challenge, p_credential_id: resp.id });
      if (!stored) throw new Error('FINGERPRINT_NOT_REGISTERED');

      const v = await swa.verifyAuthenticationResponse({
        response: resp,
        expectedChallenge: challenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        credential: {
          id: resp.id,
          publicKey: fromB64Url(stored.public_key),
          counter: Number(stored.sign_count || 0),
          transports: stored.transports || undefined
        },
        requireUserVerification: true
      });
      if (!v.verified) throw new Error('FINGERPRINT_NOT_VERIFIED');

      return await rpc('svc_passkey_login_finish', {
        p_challenge: challenge,
        p_credential_id: resp.id,
        p_new_count: v.authenticationInfo.newCounter || 0
      });
    }

    throw new Error('UNKNOWN_ACTION');
  };
}
