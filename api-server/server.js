const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
require('dotenv').config();

// Gestion sécurisée de l'initialisation Firebase
const initFirebaseAdmin = () => {
    // Récupération des variables d'environnement
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY 
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n').trim()
        : undefined;

    // Log détaillé des variables d'environnement
    console.log('🔍 Configuration Firebase:');
    console.log('Project ID:', projectId ? 'Présent' : 'MANQUANT');
    console.log('Client Email:', clientEmail ? 'Présent' : 'MANQUANT');
    console.log('Private Key:', privateKey ? 'Présent (partiellement masqué)' : 'MANQUANT');

    // Validation des variables
    if (!projectId || !clientEmail || !privateKey) {
        console.error('❌ Configuration Firebase incomplète');
        console.error('Variables manquantes:', {
            projectId: !!projectId,
            clientEmail: !!clientEmail,
            privateKey: !!privateKey
        });
        throw new Error('Configuration Firebase incomplète. Vérifiez les variables d\'environnement.');
    }

    // Configuration de Firebase Admin
    const firebaseConfig = {
        credential: admin.credential.cert({
            projectId: projectId,
            clientEmail: clientEmail,
            privateKey: privateKey
        }),
        // Configuration de Firestore
        databaseURL: `https://${projectId}.firebaseio.com`
    };

    try {
        // Vérifier si Firebase est déjà initialisé
        if (!admin.apps.length) {
            admin.initializeApp(firebaseConfig);
            console.log('✅ Firebase Admin initialisé avec succès');
        }

        // Retourner l'instance de Firestore
        const db = admin.firestore();
        
        // Test de connexion à Firestore
        console.log('🔬 Test de connexion à Firestore...');
        db.collection('test').get()
            .then(() => console.log('✅ Connexion Firestore réussie'))
            .catch(err => console.error('❌ Échec de la connexion Firestore:', err));

        return db;
    } catch (error) {
        console.error('❌ Erreur lors de l\'initialisation de Firebase Admin:', error);
        console.error('Détails de l\'erreur:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        throw error;
    }
};

// Initialisation de Firebase
let db;
try {
    db = initFirebaseAdmin();
} catch (error) {
    console.error('Impossible d\'initialiser Firebase:', error);
    process.exit(1);
}

const app = express();

// Middleware
app.use(helmet());
const corsOptions = {
    origin: [
        'http://localhost:3000', 
        'https://microserv.entrepixel.fr',
        'https://microserv-api.onrender.com'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
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
        console.log('🔐 Vérification de l\'authentification...');
        const authHeader = req.headers.authorization;
        
        if (!authHeader?.startsWith('Bearer ')) {
            console.log('❌ Token manquant dans les headers');
            return res.status(401).json({ error: 'Token manquant' });
        }

        const token = authHeader.split('Bearer ')[1];
        console.log('🔑 Token reçu, vérification...');
        
        try {
            const decodedToken = await admin.auth().verifyIdToken(token);
            console.log('✅ Token vérifié avec succès pour l\'utilisateur:', decodedToken.uid);
            req.user = decodedToken;
            next();
        } catch (verifyError) {
            console.error('❌ Erreur lors de la vérification du token:', verifyError);
            res.status(401).json({ error: 'Token invalide' });
        }
    } catch (error) {
        console.error('❌ Erreur d\'authentification:', error);
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
        console.log('Paramètres de requête:', req.query);

        // Vérifier si la connexion Firestore est établie
        if (!db) {
            console.error('❌ Connexion Firestore non établie');
            return res.status(500).json({ 
                success: false, 
                error: 'Connexion à la base de données impossible' 
            });
        }

        try {
            // Construire la requête Firestore
            const reservationsRef = db.collection('reservations');
            let query = reservationsRef
                .where('clientId', '==', req.user.uid)
                .orderBy('createdAt', 'desc');

            // Ajouter un filtre par providerId si fourni
            if (req.query.providerId) {
                console.log(`🔎 Filtrage par providerId: ${req.query.providerId}`);
                query = query.where('providerId', '==', req.query.providerId);
            }

            console.log('Préparation de la requête Firestore');
            const snapshot = await query.get();

            console.log(`Nombre de documents trouvés: ${snapshot.docs.length}`);

            // Si aucune réservation trouvée
            if (snapshot.docs.length === 0) {
                console.log(`🔍 Aucune réservation trouvée pour l'utilisateur ${req.user.uid}`);
                return res.status(200).json({
                    success: true,
                    message: 'Aucune réservation trouvée',
                    reservations: [],
                    hasReservations: false
                });
            }

            // Tableau pour stocker les réservations avec les détails du service
            const reservations = [];

            // Récupérer les détails de chaque service
            for (const doc of snapshot.docs) {
                const reservationData = doc.data();
                console.log('Données de réservation:', reservationData);
                
                try {
                    // Récupérer les détails du service
                    const serviceRef = db.collection('services').doc(reservationData.serviceId);
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

        } catch (queryError) {
            console.error('❌ Erreur lors de la requête Firestore:', queryError);
            
            // Log détaillé de l'erreur
            console.error('Détails de l\'erreur:', {
                name: queryError.name,
                message: queryError.message,
                code: queryError.code,
                stack: queryError.stack
            });

            res.status(500).json({
                success: false,
                error: 'Erreur lors de la récupération des réservations',
                details: queryError.message
            });
        }
    } catch (globalError) {
        console.error('❌ Erreur globale lors de la récupération des réservations:', globalError);
        
        res.status(500).json({
            success: false,
            error: 'Erreur interne du serveur',
            details: globalError.message
        });
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
        const serviceRef = db.collection('services').doc(serviceId);
        const serviceDoc = await serviceRef.get();

        if (!serviceDoc.exists) {
            console.error(` Service non trouvé: ${serviceId}`);
            return res.status(404).json({ 
                success: false, 
                error: 'Service non trouvé' 
            });
        }

        // Vérification des disponibilités
        const reservationsRef = db.collection('reservations');
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
