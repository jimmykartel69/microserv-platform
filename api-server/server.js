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

// Route pour récupérer les réservations de l'utilisateur
app.get('/api/reservations', authenticateUser, async (req, res) => {
    try {
        console.log('🔍 Requête de récupération des réservations');
        console.log('Utilisateur authentifié:', req.user.uid);

        // Récupérer les réservations de l'utilisateur
        const reservationsRef = admin.firestore().collection('reservations');
        const query = reservationsRef
            .where('userId', '==', req.user.uid)
            .orderBy('createdAt', 'desc');  // Trier par date de création décroissante

        const snapshot = await query.get();

        // Tableau pour stocker les réservations avec les détails du service
        const reservations = [];

        // Récupérer les détails de chaque service
        for (const doc of snapshot.docs) {
            const reservationData = doc.data();
            
            try {
                // Récupérer les détails du service
                const serviceRef = admin.firestore().collection('services').doc(reservationData.serviceId);
                const serviceDoc = await serviceRef.get();

                // Ajouter les détails du service à la réservation
                reservations.push({
                    id: doc.id,
                    ...reservationData,
                    service: serviceDoc.exists ? serviceDoc.data() : null
                });
            } catch (serviceError) {
                console.warn(`⚠️ Impossible de récupérer le service pour la réservation ${doc.id}:`, serviceError);
                
                // Ajouter la réservation même si le service n'est pas récupéré
                reservations.push({
                    id: doc.id,
                    ...reservationData,
                    service: null
                });
            }
        }

        console.log(`✅ Récupération de ${reservations.length} réservations`);

        res.status(200).json({
            success: true,
            message: 'Réservations récupérées avec succès',
            reservations: reservations
        });

    } catch (error) {
        console.error('❌ Erreur lors de la récupération des réservations:', error);
        
        // Gestion des différents types d'erreurs
        if (error.code === 'permission-denied') {
            res.status(403).json({ 
                success: false, 
                error: 'Accès non autorisé' 
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: 'Erreur interne du serveur',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
});

// Route pour créer une réservation
app.post('/api/reservations', authenticateUser, async (req, res) => {
    try {
        console.log(' Requête de réservation reçue');
        console.log('Données de la requête:', JSON.stringify(req.body, null, 2));
        console.log('Utilisateur authentifié:', req.user.uid);

        // Validation des données d'entrée
        const { 
            serviceId, 
            providerId, 
            date, 
            startTime, 
            endTime, 
            totalPrice 
        } = req.body;

        // Vérifications de base
        if (!serviceId || !providerId || !date || !startTime || !endTime) {
            console.error(' Données de réservation incomplètes');
            return res.status(400).json({ 
                success: false, 
                error: 'Données de réservation incomplètes' 
            });
        }

        // Vérification de l'existence du service
        const serviceRef = admin.firestore().collection('services').doc(serviceId);
        const serviceDoc = await serviceRef.get();

        if (!serviceDoc.exists) {
            console.error(` Service non trouvé: ${serviceId}`);
            return res.status(404).json({ 
                success: false, 
                error: 'Service non trouvé' 
            });
        }

        // Vérification des disponibilités
        const reservationsRef = admin.firestore().collection('reservations');
        const conflictQuery = await reservationsRef
            .where('serviceId', '==', serviceId)
            .where('date', '==', date)
            .where('status', '!=', 'cancelled')
            .get();

        const conflictingReservations = conflictQuery.docs.filter(doc => {
            const reservation = doc.data();
            return !(
                (startTime >= reservation.endTime) || 
                (endTime <= reservation.startTime)
            );
        });

        if (conflictingReservations.length > 0) {
            console.error(' Créneau déjà réservé');
            return res.status(409).json({ 
                success: false, 
                error: 'Créneau déjà réservé' 
            });
        }

        // Création de la réservation
        const newReservationRef = reservationsRef.doc();
        const reservationData = {
            id: newReservationRef.id,
            userId: req.user.uid,
            serviceId,
            providerId,
            date,
            startTime,
            endTime,
            totalPrice: Number(totalPrice) || 0,
            status: 'pending',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await newReservationRef.set(reservationData);

        console.log(` Réservation créée avec succès: ${newReservationRef.id}`);

        res.status(201).json({ 
            success: true, 
            message: 'Réservation créée avec succès',
            reservation: reservationData
        });

    } catch (error) {
        console.error(' Erreur lors de la création de la réservation:', error);
        
        // Gestion des différents types d'erreurs
        if (error.code === 'permission-denied') {
            res.status(403).json({ 
                success: false, 
                error: 'Accès non autorisé' 
            });
        } else if (error.code === 'not-found') {
            res.status(404).json({ 
                success: false, 
                error: 'Ressource non trouvée' 
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: 'Erreur interne du serveur',
                details: error.message 
            });
        }
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
