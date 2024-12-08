# MicroServ API Server

API backend pour le système de réservation MicroServ, développé avec Express.js et Firebase.

## 🚀 Configuration requise

- Node.js v18 ou supérieur
- npm v9 ou supérieur
- Compte Firebase avec Firestore et Authentication activés

## 📋 Variables d'environnement

Créez un fichier `.env` à la racine du projet avec les variables suivantes :

```env
NODE_ENV=development
PORT=5000

# Firebase Admin SDK
FIREBASE_PROJECT_ID=votre-project-id
FIREBASE_CLIENT_EMAIL=votre-client-email
FIREBASE_PRIVATE_KEY="votre-private-key"
```

⚠️ Note : La clé privée Firebase doit être entourée de guillemets et conserver les sauts de ligne (`\n`).

## 🛠️ Installation

1. Clonez le repository
2. Installez les dépendances :
```bash
npm install
```

## 🚀 Démarrage

### Développement
```bash
npm run dev
```

### Production
```bash
npm start
```

## 📚 API Endpoints

### Santé du serveur
```
GET /api/health
```

### Réservations

#### Lister les réservations
```
GET /api/reservations
Authorization: Bearer [token]
```

#### Créer une réservation
```
POST /api/reservations
Authorization: Bearer [token]

{
  "serviceId": "string",
  "providerId": "string",
  "date": "YYYY-MM-DD",
  "startTime": "HH:mm",
  "endTime": "HH:mm",
  "totalPrice": number
}
```

## 🔒 Authentification

L'API utilise Firebase Authentication. Chaque requête doit inclure un token Bearer JWT valide dans l'en-tête Authorization.

## 🏗️ Structure du projet

```
api-server/
├── server.js          # Point d'entrée de l'application
├── package.json       # Dépendances et scripts
├── .env              # Variables d'environnement
└── README.md         # Documentation
```

## 🔧 Configuration CORS

L'API accepte les requêtes des origines suivantes :
- https://microserv.entrepixel.fr (Production)
- http://localhost:3000 (Développement)

## ⚡ Performance

- Timeout serveur : 120 secondes
- Limite de taille des requêtes : 10MB
- Retry automatique : 3 tentatives avec délai progressif

## 🐛 Débogage

Les logs détaillés sont disponibles pour :
- Initialisation de Firebase
- Authentification
- Opérations sur les réservations

## 🚀 Déploiement

L'API est configurée pour être déployée sur Render.com. Assurez-vous de configurer les variables d'environnement dans les paramètres du service Render.

### Configuration Render recommandée

- **Environment**: Node.js
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Node Version**: 18.x

## 📝 Notes importantes

1. La clé privée Firebase doit être correctement formatée dans les variables d'environnement
2. Les timeouts sont configurés pour tenir compte des contraintes du plan gratuit de Render
3. Les erreurs sont gérées de manière centralisée avec des messages appropriés

## 🤝 Contribution

1. Fork le projet
2. Créez votre branche (`git checkout -b feature/AmazingFeature`)
3. Committez vos changements (`git commit -m 'Add some AmazingFeature'`)
4. Push vers la branche (`git push origin feature/AmazingFeature`)
5. Ouvrez une Pull Request
