import { GatsbyFunctionRequest, GatsbyFunctionResponse } from 'gatsby';

// The static site uses GitHub's own editor. No OAuth token exchange is needed.
export default function handler(
  _request: GatsbyFunctionRequest,
  response: GatsbyFunctionResponse
) {
  response.status(410).json({
    error:
      'Use the GitHub edit link in /editor to propose changes to OlympiadsXYZ/olympiads-xyz.',
  });
}
