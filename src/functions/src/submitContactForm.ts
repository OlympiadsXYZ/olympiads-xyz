import axios from 'axios';
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const submitContactForm = functions.https.onCall(async data => {
  const { name, email, moduleName, url, lang, topic, message, includeNameInIssue } = data;
  if (!name || !topic || !message || !email) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'One or more required arguments were not passed.'
    );
  }

  const body = `
## Обратна връзка

${includeNameInIssue ? `**От**: ${name}\n` : ''}
**URL**: ${url}
${moduleName ? `**Модул**: ${moduleName}` : ''}
**Вид**: ${topic}
**Съобщение**: \n
${message}
---
*Автоматично генерирано от Olympiads XYZ*`;

  try {
    const key = functions.config().contactform.issueapikey;
    const githubAPI = axios.create({
      baseURL: 'https://api.github.com',
      headers: {
        Authorization: `token ${key}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    const labels = [];
    if (
      topic.includes('Грешка') ||
      topic.includes('Неясно обяснение') ||
      topic.includes('Заявка')
    ) {
      labels.push('content');
      labels.push('good first issue');
    }
    if (topic.includes('Бъг')) {
      labels.push('website');
      labels.push('bug');
    }
    if (topic.includes('Предложение')) labels.push('enhancement');

    const title = `Обратна връзка - ${topic}${moduleName ? ` (${moduleName})` : ''}`;

    const createdIssue = await githubAPI.post(
      '/repos/OlympiadsXYZ/olympiads-xyz/issues',
      {
        title,
        body,
        labels,
      }
    );

    await admin.firestore().collection('contactFormSubmissions').add({
      name,
      email,
      moduleName,
      url,
      lang,
      topic,
      message,
      includeNameInIssue,
      issueNumber: createdIssue.data.number,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });


    return createdIssue.data.html_url;
  } catch (error) {
    console.error('GitHub API Error:', error.response?.data || error);
    throw new functions.https.HttpsError(
      'internal',
      `Failed to create GitHub issue: ${error.response?.data?.message || error.message}`
    );
  }
});

export default submitContactForm;
