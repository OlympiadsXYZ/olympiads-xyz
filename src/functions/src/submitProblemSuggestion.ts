import * as functions from 'firebase-functions';

// Retired endpoint: old clients must not write to the inherited USACO Guide repository.
const submitProblemSuggestion = functions.https.onCall(async () => {
  throw new functions.https.HttpsError(
    'failed-precondition',
    'Предлагайте задачи чрез https://github.com/OlympiadsXYZ/olympiads-xyz/issues/new'
  );
});
export default submitProblemSuggestion;
