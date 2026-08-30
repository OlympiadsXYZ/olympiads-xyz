// Role model (see docs/Roles-And-Drafts.md): Firebase custom claims
// `admin` and `author`, set via scripts/set-role.mjs. Admins see all
// drafts; authors see drafts too (editing rights are enforced by
// Firestore rules / the editor, not here).
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import * as React from 'react';
import { FirebaseAppContext } from '../context/FirebaseContext';

export type StaffRole = 'admin' | 'author' | null;

export default function useStaffRole(): {
  role: StaffRole;
  loading: boolean;
} {
  const firebaseApp = React.useContext(FirebaseAppContext);
  const [role, setRole] = React.useState<StaffRole>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!firebaseApp) return;
    const auth = getAuth(firebaseApp);
    return onAuthStateChanged(auth, async user => {
      if (!user) {
        setRole(null);
        setLoading(false);
        return;
      }
      try {
        const token = await user.getIdTokenResult();
        if (token.claims.admin) setRole('admin');
        else if (token.claims.author) setRole('author');
        else setRole(null);
      } catch (e) {
        setRole(null);
      }
      setLoading(false);
    });
  }, [firebaseApp]);

  return { role, loading };
}
