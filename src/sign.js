// Signatures between the Macs and Jérôme Director (D146), so that security never rests on the network: Ed25519 keys,
// each request signed by its Mac over its method, path, time, nonce and body, each response signed by the Director
// over its status, time, the request's nonce and its body. Private keys never leave the machine that made them.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';

// How far a request's time may be from the Director's clock, and how long a nonce is remembered.
export const SKEW_MS = 5 * 60_000;
export const NONCE_MS = 10 * 60_000;

export function newKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { public: publicKey.export({ type: 'spki', format: 'pem' }), private: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

// A key's fingerprint, as 4 groups of 4: what Fabio compares and types (`ABCD-EF01-2345-6789`).
export function fingerprint(publicPem) {
  const der = createPublicKey(publicPem).export({ type: 'spki', format: 'der' });
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 16).toUpperCase();
  return hex.match(/.{4}/g).join('-');
}

// A code as typed, with or without dashes, in any case.
export const sameCode = (a, b) => String(a).replace(/[^0-9a-f]/gi, '').toUpperCase() === String(b).replace(/[^0-9a-f]/gi, '').toUpperCase();

const digest = (body) => createHash('sha256').update(body ?? '').digest('hex');
const requestText = ({ method, path, time, nonce, body }) => `jerome-request\n${method}\n${path}\n${time}\n${nonce}\n${digest(body)}`;
const responseText = ({ status, time, nonce, body }) => `jerome-response\n${status}\n${time}\n${nonce}\n${digest(body)}`;

// The headers of a signed request from a Mac.
export function signRequest({ method, path, body, machine, privatePem, now = Date.now() }) {
  const time = String(now);
  const nonce = randomBytes(16).toString('base64url');
  const signature = sign(null, Buffer.from(requestText({ method, path, time, nonce, body })), createPrivateKey(privatePem)).toString('base64');
  return { 'x-jerome-machine': machine, 'x-jerome-time': time, 'x-jerome-nonce': nonce, 'x-jerome-signature': signature };
}

// Whether a request's signature is the Mac's and its time close enough; the nonce is checked by the caller.
export function verifyRequest({ method, path, body, headers, publicPem, now = Date.now() }) {
  const time = headers['x-jerome-time'];
  const nonce = headers['x-jerome-nonce'];
  const signature = headers['x-jerome-signature'];
  if (!time || !nonce || !signature || !/^\d+$/.test(time) || nonce.length > 64) return 'unsigned';
  if (Math.abs(now - Number(time)) > SKEW_MS) return 'time too far from the Director\'s clock';
  try {
    if (!verify(null, Buffer.from(requestText({ method, path, time, nonce, body })), createPublicKey(publicPem), Buffer.from(signature, 'base64'))) return 'bad signature';
  } catch {
    return 'bad signature';
  }
  return null;
}

export function signResponse({ status, body, nonce, privatePem, now = Date.now() }) {
  const time = String(now);
  const signature = sign(null, Buffer.from(responseText({ status, time, nonce, body })), createPrivateKey(privatePem)).toString('base64');
  return { 'x-jerome-time': time, 'x-jerome-signature': signature };
}

// Whether a response is the Director's, to this request: the nonce binds it, so an old answer cannot be replayed.
export function verifyResponse({ status, body, nonce, headers, publicPem }) {
  const time = headers.get('x-jerome-time');
  const signature = headers.get('x-jerome-signature');
  if (!time || !signature) return false;
  try {
    return verify(null, Buffer.from(responseText({ status, time, nonce, body })), createPublicKey(publicPem), Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}
