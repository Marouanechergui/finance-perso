// ============================================================
//  CONFIGURATION — À REMPLIR PAR TOI
//  Suis le guide SETUP.md pour obtenir ces valeurs.
// ============================================================

const CONFIG = {

  // OAuth Client ID créé sur Google Cloud Console
  // Format : 1234567890-abcdef...apps.googleusercontent.com
  CLIENT_ID: '63820731903-e5hliumsff7mqlru33s3t78he405vdog.apps.googleusercontent.com',

  // ID de ta Google Sheet (dans l'URL : .../spreadsheets/d/[CET_ID]/edit)
  SHEET_ID: '167zAxKtt3otFKLwuzp_bN8CEQKNt4qttSyI6CKHEQwI',

  // Emails Google autorisés (couche de sécurité supplémentaire, optionnelle)
  // - Si tableau VIDE [] → tout compte autorisé en OAuth Testing peut entrer (protection
  //   suffisante : Google bloque déjà tout email non listé en "test user").
  // - Pour activer le filtrage : mets ici les emails Gmail exacts (toi + ta femme).
  //   Ex: ['marouan@gmail.com', 'epouse@gmail.com']
  ALLOWED_EMAILS: [],

  // ⬇️ Ne pas modifier en dessous
  // openid+email+profile : nécessaires pour lire l'email de l'utilisateur (allowlist + avatar)
  // spreadsheets : accès à ta Google Sheet
  SCOPES: 'openid email profile https://www.googleapis.com/auth/spreadsheets',
  DISCOVERY_DOC: 'https://sheets.googleapis.com/$discovery/rest?version=v4',
  SHEETS: {
    CHARGES: 'Charges',
    REVENUS: 'Revenus',
    CREDIT: 'Credit',
    EPARGNE: 'Epargne',
    COURSES: 'Courses'
  }
};
