const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// Trafikverket API configuration
const TRAFIKVERKET_API_URL = 'https://api.trafikinfo.trafikverket.se/v2/data.json';
const API_KEY = process.env.TRAFIKVERKET_API_KEY;

// Helper function to make Trafikverket API requests
async function trafikverketRequest(query) {
    const xmlRequest = `
        <REQUEST>
            <LOGIN authenticationkey="${API_KEY}" />
            ${query}
        </REQUEST>
    `;

    const response = await fetch(TRAFIKVERKET_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/xml',
        },
        body: xmlRequest,
    });

    return response.json();
}

// Proxy endpoint for Trafikverket API
app.post('/api/trafikverket', async (req, res) => {
    if (!API_KEY) {
        return res.status(500).json({ error: 'API key not configured' });
    }

    const { query } = req.body;

    if (!query) {
        return res.status(400).json({ error: 'Query is required' });
    }

    try {
        const data = await trafikverketRequest(query);
        res.json(data);
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Failed to fetch data from Trafikverket' });
    }
});

// Get train announcements
app.get('/api/train/:trainNumber', async (req, res) => {
    if (!API_KEY) {
        return res.status(500).json({ error: 'API key not configured' });
    }

    const { trainNumber } = req.params;
    const date = req.query.date || new Date().toISOString().split('T')[0];

    const query = `
        <QUERY objecttype="TrainAnnouncement" schemaversion="1.6" orderby="AdvertisedTimeAtLocation">
            <FILTER>
                <AND>
                    <EQ name="AdvertisedTrainIdent" value="${trainNumber}" />
                    <EQ name="ScheduledDepartureDateTime" value="${date}" />
                </AND>
            </FILTER>
            <INCLUDE>ActivityType</INCLUDE>
            <INCLUDE>AdvertisedTimeAtLocation</INCLUDE>
            <INCLUDE>AdvertisedTrainIdent</INCLUDE>
            <INCLUDE>LocationSignature</INCLUDE>
            <INCLUDE>ToLocation</INCLUDE>
            <INCLUDE>FromLocation</INCLUDE>
            <INCLUDE>ViaFromLocation</INCLUDE>
            <INCLUDE>ViaToLocation</INCLUDE>
            <INCLUDE>TimeAtLocation</INCLUDE>
            <INCLUDE>TimeAtLocationWithSeconds</INCLUDE>
            <INCLUDE>TrackAtLocation</INCLUDE>
            <INCLUDE>Canceled</INCLUDE>
            <INCLUDE>EstimatedTimeAtLocation</INCLUDE>
            <INCLUDE>PlannedEstimatedTimeAtLocation</INCLUDE>
        </QUERY>
    `;

    try {
        const data = await trafikverketRequest(query);
        res.json(data);
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Failed to fetch train data' });
    }
});

// Get full train route including unannounced locations
app.get('/api/train/:trainNumber/full-route', async (req, res) => {
    if (!API_KEY) {
        return res.status(500).json({ error: 'API key not configured' });
    }

    const { trainNumber } = req.params;
    const date = req.query.date || new Date().toISOString().split('T')[0];

    try {
        // Step 1: Get train announcements with ViaLocations
        const announcementQuery = `
            <QUERY objecttype="TrainAnnouncement" schemaversion="1.6" orderby="AdvertisedTimeAtLocation">
                <FILTER>
                    <AND>
                        <EQ name="AdvertisedTrainIdent" value="${trainNumber}" />
                        <EQ name="ScheduledDepartureDateTime" value="${date}" />
                    </AND>
                </FILTER>
                <INCLUDE>ActivityType</INCLUDE>
                <INCLUDE>AdvertisedTimeAtLocation</INCLUDE>
                <INCLUDE>AdvertisedTrainIdent</INCLUDE>
                <INCLUDE>LocationSignature</INCLUDE>
                <INCLUDE>ToLocation</INCLUDE>
                <INCLUDE>FromLocation</INCLUDE>
                <INCLUDE>ViaFromLocation</INCLUDE>
                <INCLUDE>ViaToLocation</INCLUDE>
                <INCLUDE>TimeAtLocation</INCLUDE>
                <INCLUDE>TimeAtLocationWithSeconds</INCLUDE>
                <INCLUDE>TrackAtLocation</INCLUDE>
                <INCLUDE>Canceled</INCLUDE>
            </QUERY>
        `;

        const announcementData = await trafikverketRequest(announcementQuery);
        const announcements = announcementData.RESPONSE?.RESULT?.[0]?.TrainAnnouncement || [];

        if (announcements.length === 0) {
            return res.json({ announcements: [], allLocations: [], viaLocations: [], trainPosition: null });
        }

        // Step 2: Collect all locations including ViaFromLocation and ViaToLocation
        const allLocationSignatures = new Set();
        const orderedLocations = [];
        
        // Process announcements in order to build the complete route
        announcements.forEach((ann, index) => {
            // Add ViaFromLocation (locations before this announced station)
            if (ann.ViaFromLocation && ann.ViaFromLocation.length > 0) {
                ann.ViaFromLocation.forEach(via => {
                    if (!allLocationSignatures.has(via.LocationName)) {
                        allLocationSignatures.add(via.LocationName);
                        orderedLocations.push({
                            signature: via.LocationName,
                            isAnnounced: false,
                            order: via.Order || 0
                        });
                    }
                });
            }
            
            // Add the announced location
            if (!allLocationSignatures.has(ann.LocationSignature)) {
                allLocationSignatures.add(ann.LocationSignature);
                orderedLocations.push({
                    signature: ann.LocationSignature,
                    isAnnounced: true,
                    advertisedTime: ann.AdvertisedTimeAtLocation,
                    actualTime: ann.TimeAtLocation,
                    track: ann.TrackAtLocation,
                    activityType: ann.ActivityType
                });
            }
            
            // Add ViaToLocation (locations after this announced station)
            if (ann.ViaToLocation && ann.ViaToLocation.length > 0) {
                ann.ViaToLocation.forEach(via => {
                    if (!allLocationSignatures.has(via.LocationName)) {
                        allLocationSignatures.add(via.LocationName);
                        orderedLocations.push({
                            signature: via.LocationName,
                            isAnnounced: false,
                            order: via.Order || 0
                        });
                    }
                });
            }
        });

        // Step 3: Try to get real-time train position
        let trainPosition = null;
        try {
            const positionQuery = `
                <QUERY objecttype="TrainPosition" schemaversion="1.1">
                    <FILTER>
                        <EQ name="Train.AdvertisedTrainNumber" value="${trainNumber}" />
                    </FILTER>
                    <INCLUDE>Train.AdvertisedTrainNumber</INCLUDE>
                    <INCLUDE>Position.WGS84</INCLUDE>
                    <INCLUDE>Speed</INCLUDE>
                    <INCLUDE>Bearing</INCLUDE>
                    <INCLUDE>TimeStamp</INCLUDE>
                </QUERY>
            `;
            const positionData = await trafikverketRequest(positionQuery);
            if (positionData.RESPONSE?.RESULT?.[0]?.TrainPosition?.[0]) {
                trainPosition = positionData.RESPONSE.RESULT[0].TrainPosition[0];
            }
        } catch (e) {
            console.log('Could not fetch train position:', e.message);
        }

        // Step 4: Get TrainStation info for all locations (with correct namespace)
        const locationArray = Array.from(allLocationSignatures);
        let stations = [];
        
        if (locationArray.length > 0) {
            const locationFilters = locationArray.map(l => `<EQ name="LocationSignature" value="${l}" />`).join('');
            
            const stationQuery = `
                <QUERY objecttype="TrainStation" schemaversion="1.4" namespace="rail.infrastructure">
                    <FILTER>
                        <OR>
                            ${locationFilters}
                        </OR>
                    </FILTER>
                    <INCLUDE>LocationSignature</INCLUDE>
                    <INCLUDE>AdvertisedLocationName</INCLUDE>
                    <INCLUDE>Geometry</INCLUDE>
                </QUERY>
            `;

            const stationData = await trafikverketRequest(stationQuery);
            stations = stationData.RESPONSE?.RESULT?.[0]?.TrainStation || [];
        }

        res.json({
            announcements: announcements,
            allLocations: stations,
            orderedRoute: orderedLocations,
            viaLocations: Array.from(allLocationSignatures),
            trainPosition: trainPosition
        });

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Failed to fetch full train route' });
    }
});

// Get trains at locations
app.get('/api/trains-at-locations', async (req, res) => {
    if (!API_KEY) {
        return res.status(500).json({ error: 'API key not configured' });
    }

    const locations = req.query.locations ? req.query.locations.split(',') : [];
    const date = req.query.date || new Date().toISOString().split('T')[0];

    if (locations.length === 0) {
        return res.status(400).json({ error: 'Locations are required' });
    }

    const locationFilter = locations.map(l => `<EQ name="LocationSignature" value="${l}" />`).join('');

    const query = `
        <QUERY objecttype="TrainAnnouncement" schemaversion="1.6" orderby="AdvertisedTimeAtLocation">
            <FILTER>
                <AND>
                    <OR>
                        ${locationFilter}
                    </OR>
                    <EQ name="ScheduledDepartureDateTime" value="${date}" />
                    <EXISTS name="TimeAtLocation" value="true" />
                </AND>
            </FILTER>
            <INCLUDE>ActivityType</INCLUDE>
            <INCLUDE>AdvertisedTimeAtLocation</INCLUDE>
            <INCLUDE>AdvertisedTrainIdent</INCLUDE>
            <INCLUDE>LocationSignature</INCLUDE>
            <INCLUDE>ToLocation</INCLUDE>
            <INCLUDE>FromLocation</INCLUDE>
            <INCLUDE>TimeAtLocation</INCLUDE>
            <INCLUDE>TrackAtLocation</INCLUDE>
        </QUERY>
    `;

    try {
        const data = await trafikverketRequest(query);
        res.json(data);
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Failed to fetch trains at locations' });
    }
});

// Get train stations (with correct namespace for rail.infrastructure)
app.get('/api/stations', async (req, res) => {
    if (!API_KEY) {
        return res.status(500).json({ error: 'API key not configured' });
    }

    const query = `
        <QUERY objecttype="TrainStation" schemaversion="1.4" namespace="rail.infrastructure">
            <INCLUDE>LocationSignature</INCLUDE>
            <INCLUDE>AdvertisedLocationName</INCLUDE>
            <INCLUDE>Geometry</INCLUDE>
        </QUERY>
    `;

    try {
        const data = await trafikverketRequest(query);
        res.json(data);
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Failed to fetch stations' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚂 Tågläge server running on http://localhost:${PORT}`);
    if (!API_KEY) {
        console.warn('⚠️  Warning: TRAFIKVERKET_API_KEY is not set!');
    }
});
