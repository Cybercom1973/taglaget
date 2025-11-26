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

// Determine train direction based on first and last station
function determineTrainDirection(trainAnnouncements) {
    if (!trainAnnouncements || trainAnnouncements.length === 0) return null;
    
    var sorted = trainAnnouncements.slice().sort(function(a, b) {
        return new Date(a.AdvertisedTimeAtLocation) - new Date(b.AdvertisedTimeAtLocation);
    });
    
    var first = sorted[0];
    var last = sorted[sorted.length - 1];
    
    return {
        from: first.LocationSignature,
        to: last.LocationSignature,
        fromLocation: first.FromLocation && first.FromLocation[0] ? first.FromLocation[0].LocationName : null,
        toLocation: last.ToLocation && last.ToLocation[0] ? last.ToLocation[0].LocationName : null
    };
}

// Compare if two trains go in the same direction
function isSameDirection(dir1, dir2) {
    if (!dir1 || !dir2) return false;
    
    // Compare start and end stations
    var sameFromTo = (dir1.from === dir2.from && dir1.to === dir2.to);
    var sameLocations = (dir1.fromLocation && dir2.fromLocation && 
                         dir1.fromLocation === dir2.fromLocation && 
                         dir1.toLocation === dir2.toLocation);
    
    return sameFromTo || sameLocations;
}

// Classify all trains per station
function classifyAndStoreTrains(currentTrainNumber, currentAnnouncements, allOtherTrains) {
    var currentDirection = determineTrainDirection(currentAnnouncements);
    
    // Group all trains by train number
    var trainsByNumber = {};
    allOtherTrains.forEach(function(ann) {
        var num = ann.AdvertisedTrainIdent;
        if (!trainsByNumber[num]) {
            trainsByNumber[num] = [];
        }
        trainsByNumber[num].push(ann);
    });
    
    // Classify per station
    var trainsAtStations = {};
    
    allOtherTrains.forEach(function(ann) {
        var trainNum = ann.AdvertisedTrainIdent;
        var stationSig = ann.LocationSignature;
        
        // Skip current train
        if (trainNum === currentTrainNumber) return;
        
        // Only show trains that have actually passed (have TimeAtLocation)
        if (!ann.TimeAtLocation) return;
        
        // Create station entry if it doesn't exist
        if (!trainsAtStations[stationSig]) {
            trainsAtStations[stationSig] = {
                sameDirection: [],
                opposite: []
            };
        }
        
        // Determine direction for this train
        var trainDirection = determineTrainDirection(trainsByNumber[trainNum]);
        
        // Classify
        if (trainDirection && isSameDirection(currentDirection, trainDirection)) {
            trainsAtStations[stationSig].sameDirection.push({
                trainNumber: trainNum,
                time: ann.AdvertisedTimeAtLocation,
                actualTime: ann.TimeAtLocation,
                track: ann.TrackAtLocation
            });
        } else if (trainDirection) {
            trainsAtStations[stationSig].opposite.push({
                trainNumber: trainNum,
                time: ann.AdvertisedTimeAtLocation,
                actualTime: ann.TimeAtLocation,
                track: ann.TrackAtLocation
            });
        }
    });
    
    // Sort trains by time
    Object.keys(trainsAtStations).forEach(function(sig) {
        trainsAtStations[sig].sameDirection.sort(function(a, b) {
            return new Date(a.time) - new Date(b.time);
        });
        trainsAtStations[sig].opposite.sort(function(a, b) {
            return new Date(a.time) - new Date(b.time);
        });
    });
    
    // Store in window.trainData
    window.trainData.trainsAtStations = trainsAtStations;
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
        stationNames: {}
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

function processTrainDataFromAPI(trainNumber, announcements, orderedRoute, trainPosition, allLocationSignatures) {
    // Get station names (optional, for display)
    var locationArray = Array.from(allLocationSignatures);
    var date = new Date().toISOString().split('T')[0];
    
    if (locationArray.length > 0) {
        var locationFilters = locationArray.map(function(l) { 
            return '<EQ name="LocationSignature" value="' + escapeXml(l) + '" />'; 
        }).join('');
        
        var stationQuery = `
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
        
        // Query for other trains at the same stations
        var otherTrainsQuery = `
            <QUERY objecttype="TrainAnnouncement" schemaversion="1.6" orderby="AdvertisedTimeAtLocation">
                <FILTER>
                    <AND>
                        <OR>
                            ${locationFilters}
                        </OR>
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
                <INCLUDE>TrackAtLocation</INCLUDE>
            </QUERY>
        `;
        
        TrafikverketAPI.request(stationQuery)
            .then(function(stationData) {
                var stations = stationData.RESPONSE?.RESULT?.[0]?.TrainStation || [];
                var stationNames = {};
                stations.forEach(function(station) {
                    stationNames[station.LocationSignature] = station.AdvertisedLocationName;
                });
                window.trainData.stationNames = stationNames;
                
                // Now fetch other trains
                TrafikverketAPI.request(otherTrainsQuery)
                    .then(function(otherTrainsData) {
                        var otherTrains = otherTrainsData.RESPONSE?.RESULT?.[0]?.TrainAnnouncement || [];
                        classifyAndStoreTrains(trainNumber, announcements, otherTrains);
                        processTrainData(trainNumber, announcements, orderedRoute, trainPosition);
                    })
                    .catch(function() {
                        // Other trains data is optional, continue without it
                        processTrainData(trainNumber, announcements, orderedRoute, trainPosition);
                    });
            })
            .catch(function() {
                // Station names are optional, continue without them
                processTrainData(trainNumber, announcements, orderedRoute, trainPosition);
            });
    } else {
        processTrainData(trainNumber, announcements, orderedRoute, trainPosition);
    }
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
                viaFromLocations: announcement.ViaFromLocation || [],
                viaToLocations: announcement.ViaToLocation || []
            };
        }
        
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
    
    stations.forEach(function(station, index) {
        const $row = $('<tr>');
        
        const isCurrent = station.isCurrent;
        const inTransitZone = station.inTransitZone;
        const hasPassed = station.isAnnounced && (index < currentIndex || station.departed);
        const isUnannounced = !station.isAnnounced;
        
        const $stationCell = $('<td>').addClass('station-cell');
        $stationCell.text(station.signature);
        
        if (hasPassed) $stationCell.addClass('passed-station');
        if (isUnannounced) $stationCell.addClass('unannounced-station');
        if (inTransitZone) $stationCell.addClass('transit-zone');
        
        $row.append($stationCell);
        
        const $trainCell = $('<td>').addClass('same-direction-cell');
        
        if (isCurrent) {
            const trackInfo = station.track ? station.signature + ' ' + station.track : station.signature;
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
        }
        
        // Show other trains in the same direction
        var trainsData = window.trainData.trainsAtStations || {};
        var stationTrains = trainsData[station.signature];
        
        if (stationTrains && stationTrains.sameDirection) {
            stationTrains.sameDirection.forEach(function(train) {
                var $trainSpan = $('<div>')
                    .addClass('train-item same-train')
                    .text(train.trainNumber + ' ' + formatTime(train.time));
                $trainCell.append($trainSpan);
            });
        }
        
        $row.append($trainCell);
        
        // Column 3 - Meeting trains
        const $meetCell = $('<td>').addClass('meeting-cell');
        
        if (stationTrains && stationTrains.opposite) {
            stationTrains.opposite.forEach(function(train) {
                var $trainSpan = $('<div>')
                    .addClass('train-item meeting-train')
                    .text(train.trainNumber + ' ' + formatTime(train.time));
                $meetCell.append($trainSpan);
            });
        }
        
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