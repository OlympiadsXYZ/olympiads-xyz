// Decisions for the bounded page pilot, independent of transport and accounting.
// The runner owns a Set of paused provider IDs; other providers can continue.
// Check that Set again after asynchronous preparation and before dispatch.
// A worker already sent to the provider is an in-flight billable attempt; a
// sibling's failure cannot establish that its charge is zero.

/** HTTP status is not billing evidence. No failure authorizes an automatic
 * retry or release of a reservation. Reconcile using actual provider usage;
 * unknown charged attempts remain reserved in pilot-budget.mjs.
 *
 * Missing/invalid status covers network errors and unreadable responses. Pause
 * the provider conservatively. 400/404/422 can concern one request, so the
 * runner records them as request failures without pausing unrelated requests.
 * No timer or Retry-After header automatically reopens a paused provider.
 */
export function providerFailurePolicy(httpStatus) {
  const status = Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null;
  let pauseProvider = false, reason = null;
  if (status === null) { pauseProvider = true; reason = 'unknown_response_or_transport'; }
  else if (status === 401 || status === 403) { pauseProvider = true; reason = 'authentication_or_access'; }
  else if (status === 429) { pauseProvider = true; reason = 'rate_limit_or_quota'; }
  else if (status === 408) { pauseProvider = true; reason = 'request_timeout'; }
  else if (status >= 500) { pauseProvider = true; reason = 'provider_unavailable'; }
  else if (status < 200 || (status >= 300 && status < 400)) { pauseProvider = true; reason = 'unexpected_response_status'; }
  else if (status >= 400) reason = 'request_rejected';
  return { httpStatus: status, pauseProvider, reason, automaticRetry: false, releaseReservation: false };
}

export const shouldPauseProvider = httpStatus => providerFailurePolicy(httpStatus).pauseProvider;

export function assertPreparedSource(item) {
  if(item?.readyForDispatch===false||item?.rotationNeedsReview===true){
    const error=new Error('Source preparation review is incomplete.');
    error.code='PILOT_SOURCE_NOT_READY';throw error;
  }
}

/** Bind the bytes actually captured by the request builder to the frozen plan.
 * A plan-start filesystem check alone is insufficient: another process can
 * replace an image while earlier requests are running. Call after building the
 * request and BEFORE reserving funds or sending. The provider adapter computes
 * imageMetadata from the same captured bytes embedded in the request body.
 */
export function assertFrozenRequestImage(item, request) {
  const images = request?.imageMetadata;
  if (typeof item?.imageSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.imageSha256)
      || !Array.isArray(images) || images.length !== 1 || images[0]?.sha256 !== item.imageSha256) {
    const error = new Error('Prepared request image does not match the frozen source plan.');
    error.code = 'PILOT_SOURCE_CHANGED';
    throw error;
  }
  return true;
}
