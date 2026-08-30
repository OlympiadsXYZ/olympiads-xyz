import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

i18n
     .use(initReactI18next)
     .init({
      initImmediate: false,
       lng: 'bg', // default language
       fallbackLng: 'bg',
       interpolation: {
         escapeValue: false,
       },
       resources: {
        en: {
          translation: require('../translations/en.json')
        },
        bg: {
          translation: require('../translations/bg.json')
        }
       }
     });

   export default i18n;