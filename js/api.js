const API_CONFIG = {
    apiKey: '4759059607504e98ba567480d71df54e',
    url: 'https://api.trafikinfo.trafikverket.se/v2/data.json'
};

function escapeXmlValue(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[m]));
}

const TrafikverketAPI = {
    request: function(xmlQuery) {
        return $.ajax({
            url: API_CONFIG.url,
            method: 'POST',
            contentType: 'application/xml; charset=utf-8',
            dataType: 'json',
            data: `<REQUEST><LOGIN authenticationkey="${API_CONFIG.apiKey}" />${xmlQuery}</REQUEST>`
        });
    },

    // 1. Hämta tågets rutt (Ditt tåg)
    getTrainAnnouncements: function(trainNumber) {
        const dateStr = new Date().toLocaleDateString('sv-SE');
        const query = `
            <QUERY objecttype="TrainAnnouncement" schemaversion="1.6" orderby="AdvertisedTimeAtLocation">
                <FILTER>
                    <AND>
                        <EQ name="AdvertisedTrainIdent" value="${trainNumber}" />
                        <GT name="AdvertisedTimeAtLocation" value="${dateStr}T00:00:00" />
                        <LT name="AdvertisedTimeAtLocation" value="${dateStr}T23:59:59" />
                    </AND>
                </FILTER>
                <INCLUDE>ActivityType</INCLUDE>
                <INCLUDE>AdvertisedTimeAtLocation</INCLUDE>
                <INCLUDE>AdvertisedTrainIdent</INCLUDE>
                <INCLUDE>TechnicalTrainIdent</INCLUDE>
                <INCLUDE>LocationSignature</INCLUDE>
                <INCLUDE>ViaFromLocation</INCLUDE>
                <INCLUDE>ViaToLocation</INCLUDE>
                <INCLUDE>ToLocation</INCLUDE>
                <INCLUDE>TimeAtLocation</INCLUDE>
                <INCLUDE>TrackAtLocation</INCLUDE>
                <INCLUDE>Advertised</INCLUDE>
            </QUERY>
        `;
        return this.request(query);
    },

    // 2. Hämta andra tåg (Möten/Samma håll)
    getOtherTrains: function(locationSignatures) {
        if (!locationSignatures || locationSignatures.length === 0) {
            return Promise.resolve({ RESPONSE: { RESULT: [{ TrainAnnouncement: [] }] } });
        }
        const dateStr = new Date().toLocaleDateString('sv-SE');
        const locationFilters = locationSignatures.map(l => `<EQ name="LocationSignature" value="${l}" />`).join('');
        
        const query = `
            <QUERY objecttype="TrainAnnouncement" schemaversion="1.6" orderby="AdvertisedTimeAtLocation">
                <FILTER>
                    <AND>
                        <OR>${locationFilters}</OR>
                        <GT name="AdvertisedTimeAtLocation" value="${dateStr}T00:00:00" />
                        <LT name="AdvertisedTimeAtLocation" value="${dateStr}T23:59:59" />
                        <EXISTS name="TimeAtLocation" value="true" />
                    </AND>
                </FILTER>
                <INCLUDE>AdvertisedTimeAtLocation</INCLUDE>
                <INCLUDE>AdvertisedTrainIdent</INCLUDE>
                <INCLUDE>TechnicalTrainIdent</INCLUDE>
                <INCLUDE>LocationSignature</INCLUDE>
                <INCLUDE>TimeAtLocation</INCLUDE>
                <INCLUDE>ToLocation</INCLUDE>
                <INCLUDE>FromLocation</INCLUDE>
                <INCLUDE>ViaToLocation</INCLUDE> <INCLUDE>ViaFromLocation</INCLUDE>
                <INCLUDE>ActivityType</INCLUDE>   </QUERY>
        `;
        return this.request(query);
    },

    // 3. Hämta alla tåg på samma linje baserat på destination/ursprung
    getTrainsOnLine: function(fromLocation, toLocation) {
        const dateStr = new Date().toLocaleDateString('sv-SE');
        const safeFromLocation = escapeXmlValue(fromLocation);
        const safeToLocation = escapeXmlValue(toLocation);
        const query = `
            <QUERY objecttype="TrainAnnouncement" schemaversion="1.6" orderby="AdvertisedTimeAtLocation">
                <FILTER>
                    <AND>
                        <OR>
                            <EQ name="ToLocation.LocationName" value="${safeToLocation}" />
                            <EQ name="FromLocation.LocationName" value="${safeFromLocation}" />
                        </OR>
                        <GT name="AdvertisedTimeAtLocation" value="${dateStr}T00:00:00" />
                        <LT name="AdvertisedTimeAtLocation" value="${dateStr}T23:59:59" />
                        <EXISTS name="TimeAtLocation" value="true" />
                    </AND>
                </FILTER>
                <INCLUDE>AdvertisedTimeAtLocation</INCLUDE>
                <INCLUDE>AdvertisedTrainIdent</INCLUDE>
                <INCLUDE>TechnicalTrainIdent</INCLUDE>
                <INCLUDE>LocationSignature</INCLUDE>
                <INCLUDE>ActivityType</INCLUDE>
                <INCLUDE>TimeAtLocation</INCLUDE>
                <INCLUDE>ToLocation</INCLUDE>
                <INCLUDE>FromLocation</INCLUDE>
                <INCLUDE>ViaToLocation</INCLUDE>
                <INCLUDE>ViaFromLocation</INCLUDE>
                <INCLUDE>TrackAtLocation</INCLUDE>
                <INCLUDE>Advertised</INCLUDE>
            </QUERY>
        `;
        return this.request(query);
    }
};

window.TrafikverketAPI = TrafikverketAPI;
