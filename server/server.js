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

// Proxy endpoint for Trafikverket API
app.post('/api/trafikverket', async (req, res) => {
    if (!API_KEY) {
        return res.status(500).json({ error: 'API key not configured' });
    }

    const { query } = req.body;

    if (!query) {
        return res.status(400).json({ error: 'Query is required' });
    }

    const xmlRequest = `
        <REQUEST>
            <LOGIN authenticationkey="${API_KEY}" />
            ${query}
        </REQUEST>
    `;

    try {
        const response = await fetch(TRAFIKVERKET_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml',
            },
            body: xmlRequest,
        });

        const data = await response.json();
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

    const xmlRequest = `
        <REQUEST>
            <LOGIN authenticationkey="${API_KEY}" />
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
                <INCLUDE>TimeAtLocation</INCLUDE>
                <INCLUDE>TimeAtLocationWithSeconds</INCLUDE>
                <INCLUDE>TrackAtLocation</INCLUDE>
                <INCLUDE>Canceled</INCLUDE>
                <INCLUDE>EstimatedTimeAtLocation</INCLUDE>
                <INCLUDE>PlannedEstimatedTimeAtLocation</INCLUDE>
            </QUERY>
        </REQUEST>
    `;

    try {
        const response = await fetch(TRAFIKVERKET_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml',
            },
            body: xmlRequest,
        });

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Failed to fetch train data' });
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

    const xmlRequest = `
        <REQUEST>
            <LOGIN authenticationkey="${API_KEY}" />
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
        </REQUEST>
    `;

    try {
        const response = await fetch(TRAFIKVERKET_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml',
            },
            body: xmlRequest,
        });

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Failed to fetch trains at locations' });
    }
});

// Get train stations
app.get('/api/stations', async (req, res) => {
    if (!API_KEY) {
        return res.status(500).json({ error: 'API key not configured' });
    }

    const xmlRequest = `
        <REQUEST>
            <LOGIN authenticationkey="${API_KEY}" />
            <QUERY objecttype="TrainStation" schemaversion="1.4">
                <INCLUDE>LocationSignature</INCLUDE>
                <INCLUDE>AdvertisedLocationName</INCLUDE>
                <INCLUDE>Geometry</INCLUDE>
            </QUERY>
        </REQUEST>
    `;

    try {
        const response = await fetch(TRAFIKVERKET_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml',
            },
            body: xmlRequest,
        });

        const data = await response.json();
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
