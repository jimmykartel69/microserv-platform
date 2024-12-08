const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const admin = require('firebase-admin');
require('dotenv').config();

// Initialiser Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  })
});

const app = express();

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? 'https://votre-domaine.com' 
    : 'http://localhost:3000',
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
