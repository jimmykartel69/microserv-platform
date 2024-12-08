const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const admin = require('firebase-admin');
require('dotenv').config();

// Fonction pour formater correctement la clé privée
const formatPrivateKey = (key) => {
  if (!key) return null;
  // Si la clé est déjà au bon format, la retourner telle quelle
  if (key.includes('-----BEGIN PRIVATE KEY-----')) {
    return key.replace(/\\n/g, '\n');
  }
  // Sinon, essayer de parser la clé JSON
  try {
    return JSON.parse(key).replace(/\\n/g, '\n');
  } catch (e) {
    // Si ce n'est pas du JSON, retourner la clé telle quelle
    return key.replace(/\\n/g, '\n');
  }
};

// Initialiser Firebase Admin
try {
  const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  console.log('Initialisation de Firebase Admin...');
  
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey
    })
  });
  
  console.log('Firebase Admin initialisé avec succès');
} catch (error) {
  console.error('Erreur lors de l\'initialisation de Firebase Admin:', error);
  process.exit(1);
}

const app = express();

// Middleware
app.use(helmet());
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'DELETE', 'UPDATE', 'PUT', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

// Middleware d'authentification
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token manquant' });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
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
    const { serviceId, providerId, date, startTime, endTime, totalPrice } = req.body;

    // Validation des données
    if (!serviceId || !providerId || !date || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        error: 'Données manquantes'
      });
    }

    // Créer la réservation
    const reservationRef = admin.firestore().collection('reservations').doc();
    const reservationData = {
      userId,
      serviceId,
      providerId,
      date,
      startTime,
      endTime,
      totalPrice,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await reservationRef.set(reservationData);

    res.status(201).json({
      success: true,
      reservationId: reservationRef.id,
      ...reservationData,
      message: 'Réservation créée avec succès'
    });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur serveur' 
    });
  }
});

// Port
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
