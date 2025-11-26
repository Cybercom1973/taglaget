// Helper function to escape XML special characters
function escapeXml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

$(document).ready(function() {
    const urlParams = new URLSearchParams(window.location.search);
    const trainNumber = urlParams.get('train');
    
    if (!trainNumber) {
        window.location.href = 'index.html';
        return;
    }
    
    $('#train-label').text('Tåg ' + trainNumber);
    
    window.trainData = {
        trainNumber: trainNumber,
        schedule: [],
        currentPosition: null,
        direction: null,
        stationNames: {},
        trainsAtStations: {}
    };
    
    loadTrainData(trainNumber);
    
    $('#refresh-btn').on('click', function() {
        loadTrainData(trainNumber);
    });
    
    setInterval(function() {
        loadTrainData(trainNumber);
    }, 30000);
});

function loadTrainData(trainNumber) {
    $('#loading').show();
    $('#error-message').hide();
    $('#train-table').hide();
    
    const date = new Date().toISOString().split('T')[0];
    const escapedTrainNumber = escapeXml(trainNumber);
    
    // Step 1: Get train announcements with ViaLocations
    const announcementQuery = `
        <QUERY objecttype="TrainAnnouncement" schemaversion="1.6" orderby="AdvertisedTimeAtLocation">
            <FILTER>
                <AND>
                    <EQ name="AdvertisedTrainIdent" value="${escapedTrainNumber}" />
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
    
    TrafikverketAPI.request(announcementQuery)
        .then(function(announcementData) {
            const announcements = announcementData.RESPONSE?.RESULT?.[0]?.TrainAnnouncement || [];
            
            if (announcements.length === 0) {
                showError('Tåg ' + trainNumber + ' hittades inte för idag');
                return;
            }
            
            // Step 2: Collect all locations including ViaFromLocation and ViaToLocation
            const allLocationSignatures = new Set();
            const orderedLocations = [];
            
            announcements.forEach(function(ann) {
                // Add ViaFromLocation (locations before this announced station)
                if (ann.ViaFromLocation && ann.ViaFromLocation.length > 0) {
                    ann.ViaFromLocation.forEach(function(via) {
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
                    ann.ViaToLocation.forEach(function(via) {
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
            
            // Step 3: Try to get train position (optional)
            const positionQuery = `
                <QUERY objecttype="TrainPosition" schemaversion="1.1">
                    <FILTER>
                        <EQ name="Train.AdvertisedTrainNumber" value="${escapedTrainNumber}" />
                    </FILTER>
                    <INCLUDE>Train.AdvertisedTrainNumber</INCLUDE>
                    <INCLUDE>Position.WGS84</INCLUDE>
                    <INCLUDE>Speed</INCLUDE>
                    <INCLUDE>Bearing</INCLUDE>
                    <INCLUDE>TimeStamp</INCLUDE>
                </QUERY>
            `;
            
            TrafikverketAPI.request(positionQuery)
                .then(function(positionData) {
                    const trainPosition = positionData.RESPONSE?.RESULT?.[0]?.TrainPosition?.[0] || null;
                    processTrainDataFromAPI(trainNumber, announcements, orderedLocations, trainPosition, allLocationSignatures);
                })
                .catch(function() {
                    // Position data is optional, continue without it
                    processTrainDataFromAPI(trainNumber, announcements, orderedLocations, null, allLocationSignatures);
                });
        })
        .catch(function(error) {
            console.error('API Error:', error);
            showError('Fel vid hämtning av tågdata: ' + error.message);
        });
}

// Determine the direction of a train based on its announcements
function determineTrainDirection(trainAnnouncements) {
    if (!trainAnnouncements || trainAnnouncements.length === 0) {
        return null;
    }
    
    // Sort by advertised time
    const sorted = trainAnnouncements.slice().sort(function(a, b) {
        return new Date(a.AdvertisedTimeAtLocation) - new Date(b.AdvertisedTimeAtLocation);
    });
    
    // Get first and last locations
    const firstStation = sorted[0].LocationSignature;
    const lastStation = sorted[sorted.length - 1].LocationSignature;
    
    // Use FromLocation and ToLocation if available
    const fromLocation = sorted[0].FromLocation?.[0]?.LocationName;
    const toLocation = sorted[sorted.length - 1].ToLocation?.[0]?.LocationName;
    
    return {
        from: firstStation,
        to: lastStation,
        fromLocation: fromLocation,
        toLocation: toLocation,
        firstTime: sorted[0].AdvertisedTimeAtLocation,
        lastTime: sorted[sorted.length - 1].AdvertisedTimeAtLocation
    };
}

// Check if two trains go in the same direction
function isSameDirection(dir1, dir2) {
    if (!dir1 || !dir2) return false;
    
    // Compare based on from/to locations
    if (dir1.fromLocation && dir2.fromLocation && dir1.toLocation && dir2.toLocation) {
        return dir1.fromLocation === dir2.fromLocation && dir1.toLocation === dir2.toLocation;
    }
    
    // Fall back to comparing first and last station signatures
    return dir1.from === dir2.from && dir1.to === dir2.to;
}

// Classify trains at each station into same direction and opposite direction
function classifyTrainsAtStations(currentTrainNumber, currentTrainAnnouncements, allTrainAnnouncements, locationArray) {
    const trainsAtStations = {};
    
    // Determine our train's direction
    const ourDirection = determineTrainDirection(currentTrainAnnouncements);
    
    // Group all announcements by train number
    const trainAnnouncementsMap = {};
    allTrainAnnouncements.forEach(function(ann) {
        const trainId = ann.AdvertisedTrainIdent;
        if (!trainAnnouncementsMap[trainId]) {
            trainAnnouncementsMap[trainId] = [];
        }
        trainAnnouncementsMap[trainId].push(ann);
    });
    
    // Determine direction for each train
    const trainDirections = {};
    Object.keys(trainAnnouncementsMap).forEach(function(trainId) {
        trainDirections[trainId] = determineTrainDirection(trainAnnouncementsMap[trainId]);
    });
    
    // Initialize stations
    locationArray.forEach(function(signature) {
        trainsAtStations[signature] = {
            sameDirection: [],
            opposite: []
        };
    });
    
    // Classify trains at each station
    allTrainAnnouncements.forEach(function(ann) {
        const trainId = ann.AdvertisedTrainIdent;
        const signature = ann.LocationSignature;
        
        // Skip our own train
        if (trainId === currentTrainNumber) {
            return;
        }
        
        // Skip if station not in our list
        if (!trainsAtStations[signature]) {
            return;
        }
        
        const trainDir = trainDirections[trainId];
        
        // Create train info object
        const trainInfo = {
            AdvertisedTrainIdent: trainId,
            AdvertisedTimeAtLocation: ann.AdvertisedTimeAtLocation,
            TimeAtLocation: ann.TimeAtLocation,
            TrackAtLocation: ann.TrackAtLocation,
            ActivityType: ann.ActivityType
        };
        
        // Check if same direction or opposite
        if (isSameDirection(trainDir, ourDirection)) {
            // Avoid duplicates (same train at same station)
            const exists = trainsAtStations[signature].sameDirection.some(function(t) {
                return t.AdvertisedTrainIdent === trainId && t.AdvertisedTimeAtLocation === ann.AdvertisedTimeAtLocation;
            });
            if (!exists) {
                trainsAtStations[signature].sameDirection.push(trainInfo);
            }
        } else {
            // Avoid duplicates
            const exists = trainsAtStations[signature].opposite.some(function(t) {
                return t.AdvertisedTrainIdent === trainId && t.AdvertisedTimeAtLocation === ann.AdvertisedTimeAtLocation;
            });
            if (!exists) {
                trainsAtStations[signature].opposite.push(trainInfo);
            }
        }
    });
    
    // Sort trains by time at each station
    Object.keys(trainsAtStations).forEach(function(signature) {
        trainsAtStations[signature].sameDirection.sort(function(a, b) {
            return new Date(a.AdvertisedTimeAtLocation) - new Date(b.AdvertisedTimeAtLocation);
        });
        trainsAtStations[signature].opposite.sort(function(a, b) {
            return new Date(a.AdvertisedTimeAtLocation) - new Date(b.AdvertisedTimeAtLocation);
        });
    });
    
    return trainsAtStations;
}

function processTrainDataFromAPI(trainNumber, announcements, orderedRoute, trainPosition, allLocationSignatures) {
    // Get station names (optional, for display)
    const locationArray = Array.from(allLocationSignatures);
    const date = new Date().toISOString().split('T')[0];
    
    if (locationArray.length > 0) {
        const locationFilters = locationArray.map(function(l) { 
            return '<EQ name="LocationSignature" value="' + escapeXml(l) + '" />'; 
        }).join('');
        
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
        
        // Query to get other trains at the same locations
        const otherTrainsQuery = `
            <QUERY objecttype="TrainAnnouncement" schemaversion="1.6" orderby="AdvertisedTimeAtLocation">
                <FILTER>
                    <AND>
                        <OR>
                            ${locationFilters}
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
        
        // Fetch both station names and other trains in parallel
        Promise.all([
            TrafikverketAPI.request(stationQuery).catch(function() { return { RESPONSE: { RESULT: [{ TrainStation: [] }] } }; }),
            TrafikverketAPI.request(otherTrainsQuery).catch(function() { return { RESPONSE: { RESULT: [{ TrainAnnouncement: [] }] } }; })
        ]).then(function(results) {
            const stationData = results[0];
            const otherTrainsData = results[1];
            
            // Process station names
            const stations = stationData.RESPONSE?.RESULT?.[0]?.TrainStation || [];
            const stationNames = {};
            stations.forEach(function(station) {
                stationNames[station.LocationSignature] = station.AdvertisedLocationName;
            });
            window.trainData.stationNames = stationNames;
            
            // Process other trains data
            const otherTrainAnnouncements = otherTrainsData.RESPONSE?.RESULT?.[0]?.TrainAnnouncement || [];
            const trainsAtStations = classifyTrainsAtStations(trainNumber, announcements, otherTrainAnnouncements, locationArray);
            window.trainData.trainsAtStations = trainsAtStations;
            
            processTrainData(trainNumber, announcements, orderedRoute, trainPosition);
        }).catch(function() {
            // Continue without station names or other trains data
            processTrainData(trainNumber, announcements, orderedRoute, trainPosition);
        });
    } else {
        processTrainData(trainNumber, announcements, orderedRoute, trainPosition);
    }
}

// Helper function to merge via-locations avoiding duplicates
function mergeViaLocations(existingVia, newVia, existingSet) {
    if (!newVia || newVia.length === 0) return;
    newVia.forEach(function(via) {
        if (!existingSet.has(via.LocationName)) {
            existingSet.add(via.LocationName);
            existingVia.push(via);
        }
    });
}

function processTrainData(trainNumber, announcements, orderedRoute, trainPosition) {
    const announcementMap = {};
    
    announcements.forEach(function(announcement) {
        const location = announcement.LocationSignature;
        
        if (!announcementMap[location]) {
            announcementMap[location] = {
                signature: location,
                isAnnounced: true,
                advertisedTime: announcement.AdvertisedTimeAtLocation,
                actualTime: announcement.TimeAtLocation || null,
                track: announcement.TrackAtLocation || '',
                activityType: announcement.ActivityType,
                departed: false,
                arrived: false,
                isCurrent: false,
                viaFromLocations: [],
                viaToLocations: [],
                viaFromSet: new Set(),
                viaToSet: new Set()
            };
        }
        
        // Merge viaFromLocations from all announcements for this location
        mergeViaLocations(
            announcementMap[location].viaFromLocations,
            announcement.ViaFromLocation,
            announcementMap[location].viaFromSet
        );
        
        // Merge viaToLocations from all announcements for this location
        mergeViaLocations(
            announcementMap[location].viaToLocations,
            announcement.ViaToLocation,
            announcementMap[location].viaToSet
        );
        
        if (announcement.ActivityType === 'Ankomst') {
            announcementMap[location].arrived = !!announcement.TimeAtLocation;
            announcementMap[location].arrivalTime = announcement.TimeAtLocation;
        }
        if (announcement.ActivityType === 'Avgang') {
            announcementMap[location].departed = !!announcement.TimeAtLocation;
            announcementMap[location].departureTime = announcement.TimeAtLocation;
            announcementMap[location].track = announcement.TrackAtLocation || announcementMap[location].track;
        }
    });
    
    const stations = [];
    const addedLocations = new Set();
    
    const sortedAnnounced = Object.values(announcementMap).sort(function(a, b) {
        return new Date(a.advertisedTime) - new Date(b.advertisedTime);
    });
    
    sortedAnnounced.forEach(function(station, index) {
        if (station.viaFromLocations && station.viaFromLocations.length > 0) {
            const sortedVia = station.viaFromLocations.slice().sort(function(a, b) {
                return (a.Order || 0) - (b.Order || 0);
            });
            
            sortedVia.forEach(function(via) {
                if (!addedLocations.has(via.LocationName)) {
                    addedLocations.add(via.LocationName);
                    stations.push({
                        signature: via.LocationName,
                        isAnnounced: false,
                        departed: false,
                        arrived: false,
                        isCurrent: false
                    });
                }
            });
        }
        
        if (!addedLocations.has(station.signature)) {
            addedLocations.add(station.signature);
            stations.push(station);
        }
        
        if (station.viaToLocations && station.viaToLocations.length > 0) {
            const sortedVia = station.viaToLocations.slice().sort(function(a, b) {
                return (a.Order || 0) - (b.Order || 0);
            });
            
            sortedVia.forEach(function(via) {
                if (!addedLocations.has(via.LocationName)) {
                    addedLocations.add(via.LocationName);
                    stations.push({
                        signature: via.LocationName,
                        isAnnounced: false,
                        departed: false,
                        arrived: false,
                        isCurrent: false
                    });
                }
            });
        }
    });
    
    let currentIndex = -1;
    for (let i = 0; i < stations.length; i++) {
        if (stations[i].isAnnounced && (stations[i].departed || stations[i].arrived)) {
            currentIndex = i;
        }
    }
    
    if (currentIndex >= 0) {
        if (stations[currentIndex].departed && currentIndex < stations.length - 1) {
            stations[currentIndex].trainBetweenHereAndNext = true;
            
            for (let i = currentIndex + 1; i < stations.length; i++) {
                if (!stations[i].isAnnounced) {
                    stations[i].inTransitZone = true;
                } else {
                    break;
                }
            }
        } else {
            stations[currentIndex].isCurrent = true;
        }
    }
    
    if (trainPosition && trainPosition.Position) {
        window.trainData.gpsPosition = trainPosition;
    }
    
    window.trainData.schedule = stations;
    window.trainData.currentPosition = currentIndex >= 0 ? stations[currentIndex] : null;
    
    renderTrainTable(trainNumber, stations, currentIndex);
    
    $('#loading').hide();
    $('#train-table').show();
    updateLastRefresh();
}

function renderTrainTable(trainNumber, stations, currentIndex) {
    const $tbody = $('#table-body');
    $tbody.empty();
    
    // Get station names map for display
    const stationNames = (window.trainData && window.trainData.stationNames) || {};
    
    // Get trains at stations data
    const trainsAtStations = (window.trainData && window.trainData.trainsAtStations) || {};
    
    stations.forEach(function(station, index) {
        const $row = $('<tr>');
        
        const isCurrent = station.isCurrent;
        const inTransitZone = station.inTransitZone;
        const hasPassed = station.isAnnounced && (index < currentIndex || station.departed);
        const isUnannounced = !station.isAnnounced;
        
        const $stationCell = $('<td>').addClass('station-cell');
        
        // Display station name if available, otherwise fall back to signature
        const displayName = stationNames[station.signature] || station.signature;
        $stationCell.text(displayName);
        
        if (hasPassed) $stationCell.addClass('passed-station');
        if (isUnannounced) $stationCell.addClass('unannounced-station');
        if (inTransitZone) $stationCell.addClass('transit-zone');
        
        $row.append($stationCell);
        
        const $trainCell = $('<td>').addClass('same-direction-cell');
        
        if (isCurrent) {
            const stationDisplayName = stationNames[station.signature] || station.signature;
            const trackInfo = station.track ? stationDisplayName + ' ' + station.track : stationDisplayName;
            const $trainSpan = $('<div>')
                .addClass('train-item current-train')
                .text(trainNumber + ' ' + trackInfo);
            $trainCell.append($trainSpan);
        }
        
        if (inTransitZone) {
            const $trainSpan = $('<div>')
                .addClass('train-item transit-train')
                .text('← ' + trainNumber + ' på väg');
            $trainCell.append($trainSpan);
        }
        
        if (station.isAnnounced && station.advertisedTime) {
            const time = formatTime(station.advertisedTime);
            const $timeSpan = $('<div>').addClass('scheduled-time').text(time);
            if (station.actualTime) {
                const actualTime = formatTime(station.actualTime);
                $timeSpan.append($('<span>').addClass('actual-time').text(' (' + actualTime + ')'));
            }
            $trainCell.append($timeSpan);
        } else if (isUnannounced) {
            // Show indicator for unannounced stations
            const $noInfoSpan = $('<div>').addClass('no-info-text').text('(passerar)');
            $trainCell.append($noInfoSpan);
        }
        
        // Add same direction trains from other trains
        const stationTrains = trainsAtStations[station.signature] || { sameDirection: [], opposite: [] };
        stationTrains.sameDirection.forEach(function(train) {
            const $trainSpan = $('<div>')
                .addClass('train-item same-train')
                .text(train.AdvertisedTrainIdent + ' ' + formatTime(train.AdvertisedTimeAtLocation));
            $trainCell.append($trainSpan);
        });
        
        $row.append($trainCell);
        
        // Column 3: Meeting trains (opposite direction)
        const $meetCell = $('<td>').addClass('meeting-cell');
        stationTrains.opposite.forEach(function(train) {
            const $trainSpan = $('<div>')
                .addClass('train-item meeting-train')
                .text(train.AdvertisedTrainIdent + ' ' + formatTime(train.AdvertisedTimeAtLocation));
            $meetCell.append($trainSpan);
        });
        $row.append($meetCell);
        
        $tbody.append($row);
    });
}

function formatTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

function showError(message) {
    $('#loading').hide();
    $('#error-message').text(message).show();
}

function updateLastRefresh() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('#last-update').text('Uppdaterad: ' + timeStr);
}