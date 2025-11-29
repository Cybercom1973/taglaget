// API Configuration
const API_CONFIG = {
    // API key for direct Trafikverket API calls
    apiKey: '4759059607504e98ba567480d71df54e',
    
    // Use direct API calls (no backend proxy needed)
    useProxy: false,
    proxyUrl: '/api',
    
    // Trafikverket API endpoint - use data.xml for XML requests
    trafikverketUrl: 'https://api.trafikinfo.trafikverket.se/v2/data.xml'
};

// API wrapper for Trafikverket
const TrafikverketAPI = {
    apiKey: API_CONFIG.apiKey,
    
    // Initialize with API key
    init: function(apiKey) {
        this.apiKey = apiKey || API_CONFIG.apiKey;
    },
    
    // Make API request to Trafikverket
    request: function(query) {
        const self = this;
        
        return new Promise(function(resolve, reject) {
            if (API_CONFIG.useProxy) {
                // Use backend proxy
                $.ajax({
                    url: API_CONFIG.proxyUrl + '/trafikverket',
                    method: 'POST',
                    contentType: 'application/json',
                    data: JSON.stringify({ query: query }),
                    success: resolve,
                    error: function(xhr, status, error) {
                        reject(new Error(error || 'API request failed')); 
                    }
                });
            } else {
                // Direct API call
                const xmlRequest = `
                    <REQUEST>
                        <LOGIN authenticationkey="${self.apiKey}" />
                        ${query}
                    </REQUEST>
                `;
                
                $.ajax({
                    url: API_CONFIG.trafikverketUrl,
                    method: 'POST',
                    contentType: 'application/xml; charset=utf-8',
                    data: xmlRequest.trim(),
                    success: resolve,
                    error: function(xhr, status, error) {
                        console.error('API Error Response:', xhr.responseText);
                        reject(new Error(error || 'API request failed'));
                    }
                });
            }
        });
    },
    
    // Get train announcements for a specific train
    getTrainAnnouncements: function(trainNumber, date) {
        const dateStr = date || new Date().toISOString().split('T')[0];
        
        const query = `
            <QUERY objecttype="TrainAnnouncement" schemaversion="1.6" orderby="AdvertisedTimeAtLocation">
                <FILTER>
                    <AND>
                        <EQ name="AdvertisedTrainIdent" value="${trainNumber}" />
                        <EQ name="ScheduledDepartureDateTime" value="${dateStr}" />
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
                <INCLUDE>Canceled</INCLUDE>
            </QUERY>
        `;
        
        return this.request(query);
    },
    
    // Get all trains at specific locations
    getTrainsAtLocations: function(locations, date) {
        const dateStr = date || new Date().toISOString().split('T')[0];
        const locationList = locations.map(l => `<EQ name="LocationSignature" value="${l}" />`).join('');
        
        const query = `
            <QUERY objecttype="TrainAnnouncement" schemaversion="1.6" orderby="AdvertisedTimeAtLocation">
                <FILTER>
                    <AND>
                        <OR>
                            ${locationList}
                        </OR>
                        <EQ name="ScheduledDepartureDateTime" value="${dateStr}" />
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
        
        return this.request(query);
    },
    
    // Get train stations/locations
    getTrainStations: function() {
        const query = `
            <QUERY objecttype="TrainStation" schemaversion="1.4">
                <INCLUDE>LocationSignature</INCLUDE>
                <INCLUDE>AdvertisedLocationName</INCLUDE>
                <INCLUDE>Geometry</INCLUDE>
            </QUERY>
        `;
        
        return this.request(query);
    }
};

// Export for use in other files
window.TrafikverketAPI = TrafikverketAPI;