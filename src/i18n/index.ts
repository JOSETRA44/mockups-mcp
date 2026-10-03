import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en'

/** All UI copy goes through i18next; add a locale by adding a resource file. */
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
