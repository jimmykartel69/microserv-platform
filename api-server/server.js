const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const admin = require('firebase-admin');
require('dotenv').config();

// Gestion robuste de la clé privée Firebase
const privateKey = process.env.FIREBASE_PRIVATE_KEY 
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n').trim()
    : undefined;

// Validation de la configuration Firebase
if (!process.env.FIREBASE_PROJECT_ID) {
    console.error('ERREUR: FIREBASE_PROJECT_ID non défini');
    process.exit(1);
}

if (!process.env.FIREBASE_CLIENT_EMAIL) {
    console.error('ERREUR: FIREBASE_CLIENT_EMAIL non défini');
    process.exit(1);
}

if (!privateKey) {
    console.error('ERREUR: FIREBASE_PRIVATE_KEY non défini');
    process.exit(1);
}

// Logs de débogage détaillés
console.log('Configuration Firebase:');
console.log('Project ID:', process.env.FIREBASE_PROJECT_ID);
console.log('Client Email:', process.env.FIREBASE_CLIENT_EMAIL);
console.log('Début de la clé privée:', privateKey.substring(0, 50) + '...');

// Configuration de Firebase Admin
const firebaseConfig = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey
};

try {
    admin.initializeApp({
        credential: admin.credential.cert(firebaseConfig),
        // Configuration de Firestore si nécessaire
        // databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`
    });
    console.log('✅ Firebase Admin initialisé avec succès');
} catch (error) {
    console.error('❌ Erreur lors de l\'initialisation de Firebase Admin:', error);
    process.exit(1);
}

const app = express();

// Middleware
app.use(helmet());
app.use(cors({
  origin: ['https://microserv.entrepixel.fr', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Augmenter le timeout du serveur
app.use((req, res, next) => {
  res.setTimeout(120000); // 2 minutes
  next();
});

// Middleware d'authentification
const authenticateUser = async (req, res, next) => {
  try {
    console.log('Vérification de l\'authentification...');
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      console.log('Token manquant dans les headers');
      return res.status(401).json({ error: 'Token manquant' });
    }

    const token = authHeader.split('Bearer ')[1];
    console.log('Token reçu, vérification...');
    
    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      console.log('Token vérifié avec succès pour l\'utilisateur:', decodedToken.uid);
      req.user = decodedToken;
      next();
    } catch (verifyError) {
      console.error('Erreur lors de la vérification du token:', verifyError);
      res.status(401).json({ error: 'Token invalide' });
    }
  } catch (error) {
    console.error('Erreur d\'authentification:', error);
    res.status(401).json({ error: 'Non autorisé' });
  }
};

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Route pour récupérer les réservations
app.get('/api/reservations', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.log('Récupération des réservations pour userId:', userId);
    
    // Ajouter un timeout de 25 secondes pour Firestore
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout Firestore')), 25000)
    );

    const queryPromise = admin.firestore()
      .collection('reservations')
      .where('clientId', '==', userId.trim())  // Assurez-vous que l'ID est trimé
      .orderBy('createdAt', 'desc')
      .get();

    const reservationsSnapshot = await Promise.race([queryPromise, timeoutPromise]);

    // Si aucune réservation n'est trouvée, retourner un tableau vide
    if (reservationsSnapshot.empty) {
      console.log('Aucune réservation trouvée pour l\'utilisateur:', userId);
      return res.json({
        success: true,
        reservations: [],
        message: 'Aucune réservation trouvée'
      });
    }

    const reservations = await Promise.all(reservationsSnapshot.docs.map(async doc => {
      const data = doc.data();
      
      // Récupérer les informations du service si serviceId existe
      let serviceInfo = {};
      if (data.serviceId && data.serviceId.trim()) {
        try {
          const serviceDoc = await admin.firestore()
            .collection('services')
            .doc(data.serviceId.trim())
            .get();
          
          if (serviceDoc.exists) {
            const serviceData = serviceDoc.data();
            serviceInfo = {
              title: serviceData.title || '',
              category: serviceData.category || '',
              price: serviceData.price || 0
            };
          }
        } catch (error) {
          console.error('Erreur lors de la récupération du service:', error);
        }
      }

      return {
        id: doc.id,
        clientId: (data.clientId || '').trim(),
        date: (data.date || '').trim(),
        startTime: (data.startTime || '').trim(),
        endTime: (data.endTime || '').trim(),
        providerId: (data.providerId || '').trim(),
        serviceId: (data.serviceId || '').trim(),
        status: data.status || 'pending',
        totalPrice: data.totalPrice || 0,
        createdAt: data.createdAt ? data.createdAt.toDate() : null,
        updatedAt: data.updatedAt ? data.updatedAt.toDate() : null,
        service: serviceInfo
      };
    }));

    console.log(`${reservations.length} réservations trouvées`);
    
    res.json({
      success: true,
      reservations,
      message: reservations.length > 0 ? 'Réservations récupérées avec succès' : 'Aucune réservation trouvée'
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des réservations:', error);
    
    const errorMessage = error.message === 'Timeout Firestore'
      ? 'Le service de base de données met trop de temps à répondre'
      : 'Erreur lors de la récupération des réservations';
    
    res.status(error.message === 'Timeout Firestore' ? 504 : 500).json({ 
      success: false, 
      error: errorMessage
    });
  }
});

// Route pour créer une réservation
app.post('/api/reservations', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.log('Création de réservation - Données reçues:', {
      userId,
      body: req.body
    });

    const { serviceId, providerId, date, startTime, endTime, totalPrice } = req.body;

    // Validation des données
    if (!serviceId || !providerId) {
      console.log('Validation échouée - Données manquantes:', { serviceId, providerId });
      return res.status(400).json({
        success: false,
        error: 'serviceId et providerId sont requis'
      });
    }

    // Vérifier si le service existe
    try {
      const serviceDoc = await admin.firestore()
        .collection('services')
        .doc(serviceId.trim())
        .get();

      if (!serviceDoc.exists) {
        console.log('Service non trouvé:', serviceId);
        return res.status(404).json({
          success: false,
          error: 'Service non trouvé'
        });
      }

      console.log('Service trouvé:', serviceDoc.data());
    } catch (error) {
      console.error('Erreur lors de la vérification du service:', error);
      throw error;
    }

    // Créer la réservation
    console.log('Création de la réservation avec les données:', {
      clientId: userId,
      serviceId: serviceId.trim(),
      providerId: providerId.trim(),
      date,
      startTime,
      endTime,
      totalPrice
    });

    const reservationData = {
      clientId: userId,
      serviceId: serviceId.trim(),
      providerId: providerId.trim(),
      date: date || '',
      startTime: startTime || '',
      endTime: endTime || '',
      totalPrice: Number(totalPrice) || 0,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await admin.firestore()
      .collection('reservations')
      .add(reservationData);

    console.log('Réservation créée avec succès:', {
      id: docRef.id,
      ...reservationData
    });

    res.status(201).json({
      success: true,
      reservationId: docRef.id,
      message: 'Réservation créée avec succès'
    });
  } catch (error) {
    console.error('Erreur détaillée lors de la création de la réservation:', {
      error: error.message,
      stack: error.stack,
      code: error.code
    });
    
    let errorMessage = 'Erreur lors de la création de la réservation';
    let statusCode = 500;

    if (error.code === 'permission-denied') {
      errorMessage = 'Accès non autorisé à la base de données';
      statusCode = 403;
    } else if (error.code === 'not-found') {
      errorMessage = 'Service ou ressource non trouvé';
      statusCode = 404;
    } else if (error.code === 'resource-exhausted') {
      errorMessage = 'Limite de requêtes atteinte, veuillez réessayer plus tard';
      statusCode = 429;
    }
    
    res.status(statusCode).json({ 
      success: false, 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Middleware de gestion des erreurs globales
app.use((error, req, res, next) => {
  console.error('Erreur globale:', error);
  res.status(500).json({
    success: false,
    error: 'Une erreur inattendue est survenue'
  });
});

// Port
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
