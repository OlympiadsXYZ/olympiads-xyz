import { updateProfile } from 'firebase/auth';
import React from 'react';
import toast from 'react-hot-toast';
import { useFirebaseUser } from '../../context/UserDataContext/UserDataContext';
import { useTranslation } from 'react-i18next';
import '../../i18n';

export default function Profile(): JSX.Element {
  const { t } = useTranslation();
  const firebaseUser = useFirebaseUser();

  const [name, setName] = React.useState(firebaseUser?.displayName);

  React.useEffect(() => {
    if (firebaseUser?.displayName) {
      setName(firebaseUser.displayName);
    } else {
      setName(null);
    }
  }, [firebaseUser?.displayName]);

  const handleSubmit = e => {
    if (!firebaseUser) throw new Error('User not logged in');
    e.preventDefault();
    updateProfile(firebaseUser, { displayName: name });

    toast.success('Username updated');
  };

  return (
    <div>
      <div className="space-y-1">
        <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-gray-100">
          {t('settings_profile')}
        </h3>
      </div>
      <div className="h-4" />
      {firebaseUser ? (
        <form className="space-y-6" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="display_name"
              className="block text-sm font-medium text-gray-700 dark:text-gray-200"
            >
              {t('settings_display-name')}
            </label>
            <div className="mt-1">
              <input
                type="text"
                name="display_name"
                id="display_name"
                className="input"
                value={name ?? undefined}
                onChange={e => setName(e.target.value)}
              />
            </div>
          </div>

          <div className="flex">
            <button type="submit" className="btn-primary">
              {t('settings_save')}
            </button>
          </div>
        </form>
      ) : (
        <p>{t('settings_you-need-to-be-logged-in-to-update-your-profile')}</p>
      )}
    </div>
  );
}
