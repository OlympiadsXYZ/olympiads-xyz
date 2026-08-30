import { Timestamp } from 'firebase/firestore';

export type UserSolutionForProblem = {
  id: string;
  userID: string;
  userName: string;
  problemID: string;
  isPublic: boolean;
  solutionCode: string;
  upvotes: string[];
  language: 'bg' | 'en' | 'unknown';
  timestamp: Timestamp;
};