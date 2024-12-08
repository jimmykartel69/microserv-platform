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
    
    const reservationsSnapshot = await admin.firestore()
      .collection('reservations')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const reservations = reservationsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({
      success: true,
      reservations,
      message: 'Réservations récupérées avec succès'
    });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur serveur' 
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
