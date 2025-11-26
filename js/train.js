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

// Determine train direction based on FromLocation and ToLocation from API
function determineTrainDirection(trainAnnouncements) {
    if (!trainAnnouncements || trainAnnouncements.length === 0) return null;
    
    // Find first announcement with FromLocation (origin)
    var fromLocation = null;
    for (var i = 0; i < trainAnnouncements.length; i++) {
        if (trainAnnouncements[i].FromLocation && trainAnnouncements[i].FromLocation[0]) {
            fromLocation = trainAnnouncements[i].FromLocation[0].LocationName;
            break;
        }
    }
    
    // Find first announcement with ToLocation (destination)
    var toLocation = null;
    for (var i = 0; i < trainAnnouncements.length; i++) {
        if (trainAnnouncements[i].ToLocation && trainAnnouncements[i].ToLocation[0]) {
            toLocation = trainAnnouncements[i].ToLocation[0].LocationName;
            break;
        }
    }
    
    // Get first and last station signatures for destination display
    var sorted = trainAnnouncements.slice().sort(function(a, b) {
        return new Date(a.AdvertisedTimeAtLocation) - new Date(b.AdvertisedTimeAtLocation);
    });
    var last = sorted[sorted.length - 1];
    
    return {
        fromLocation: fromLocation,
        toLocation: toLocation,
        to: last.LocationSignature  // Keep for destination display
    };
}

// Check if two trains have the same origin
function hasSameOrigin(dir1, dir2) {
    if (!dir1 || !dir2) return false;
    if (!dir1.fromLocation || !dir2.fromLocation) return false;
    
    return dir1.fromLocation === dir2.fromLocation;
}

// Check if two trains have the same destination
function hasSameDestination(dir1, dir2) {
    if (!dir1 || !dir2) return false;
    if (!dir1.toLocation || !dir2.toLocation) return false;
    
    return dir1.toLocation === dir2.toLocation;
}

// Format delay information
function formatDelay(advertisedTime, actualTime) {
    if (!actualTime || !advertisedTime) return 'Ingen info';
    
    var scheduled = new Date(advertisedTime);
    var actual = new Date(actualTime);
    var diffMs = actual - scheduled;
    var diffMin = Math.round(diffMs / 60000);
    
    if (diffMin === 0) {
        return 'I tid';
    } else if (diffMin > 0) {
        return '+' + diffMin + ' min';
    } else {
        return diffMin + ' min';
    }
}

// Classify all trains per station
function classifyAndStoreTrains(currentTrainNumber, currentAnnouncements, allOtherTrains, trainGPSPositions) {
    var currentDirection = determineTrainDirection(currentAnnouncements);
    
    // Calculate time window: only trains passed within the last 15 minutes
    var now = new Date();
    var recentTimeLimit = new Date(now.getTime() - 15 * 60000); // 15 min ago
    
    // Group all trains by train number
    var trainsByNumber = {};
    allOtherTrains.forEach(function(ann) {
        var num = ann.AdvertisedTrainIdent;
        if (!trainsByNumber[num]) {
            trainsByNumber[num] = [];
        }
        trainsByNumber[num].push(ann);
    });
    
    // First: Find each train's CURRENT position (latest station with TimeAtLocation)
    var trainCurrentPositions = {};
    
    Object.keys(trainsByNumber).forEach(function(trainNum) {
        if (trainNum === currentTrainNumber) return;
        
        var announcements = trainsByNumber[trainNum];
        
        // Sort by time
        var sorted = announcements.slice().sort(function(a, b) {
            return new Date(a.AdvertisedTimeAtLocation) - new Date(b.AdvertisedTimeAtLocation);
        });
        
        // Find LATEST station with TimeAtLocation (actually passed)
        var currentPosition = null;
        for (var i = sorted.length - 1; i >= 0; i--) {
            if (sorted[i].TimeAtLocation) {
                currentPosition = {
                    station: sorted[i].LocationSignature,
                    time: sorted[i].AdvertisedTimeAtLocation,
                    actualTime: sorted[i].TimeAtLocation,
                    track: sorted[i].TrackAtLocation
                };
                break;
            }
        }
        
        if (!currentPosition) return; // Train hasn't passed any station yet
        
        // NEW: Filter based on GPS position
        var hasGPS = trainGPSPositions && trainGPSPositions[trainNum];
        
        if (hasGPS) {
            // Train has GPS → it's currently running → show it! ✅
            trainCurrentPositions[trainNum] = currentPosition;
        } else {
            // No GPS → check if it passed recently
            var passedTime = new Date(currentPosition.actualTime);
            
            if (passedTime >= recentTimeLimit) {
                // Passed within 15 min → show it ✅
                trainCurrentPositions[trainNum] = currentPosition;
            }
            // Otherwise: too old, don't show ❌
        }
    });
    
    // Then: Add each train ONLY at its current position
    var trainsAtStations = {};
    
    Object.keys(trainCurrentPositions).forEach(function(trainNum) {
        var position = trainCurrentPositions[trainNum];
        var stationSig = position.station;
        
        if (!trainsAtStations[stationSig]) {
            trainsAtStations[stationSig] = {
                sameOrigin: [],
                sameDestination: []
            };
        }
        
        var trainDirection = determineTrainDirection(trainsByNumber[trainNum]);
        
        // Get destination signature from trainDirection (already computed from sorted announcements)
        var destinationSignature = trainDirection ? trainDirection.to : '?';
        
        // Left column: Trains from the same origin
        if (trainDirection && hasSameOrigin(currentDirection, trainDirection)) {
            trainsAtStations[stationSig].sameOrigin.push({
                trainNumber: trainNum,
                time: position.time,
                actualTime: position.actualTime,
                track: position.track,
                destinationSignature: destinationSignature
            });
        }
        
        // Right column: Trains to the same destination
        if (trainDirection && hasSameDestination(currentDirection, trainDirection)) {
            trainsAtStations[stationSig].sameDestination.push({
                trainNumber: trainNum,
                time: position.time,
                actualTime: position.actualTime,
                track: position.track,
                destinationSignature: destinationSignature
            });
        }
    });
    
    // Sort trains by time
    Object.keys(trainsAtStations).forEach(function(sig) {
        trainsAtStations[sig].sameOrigin.sort(function(a, b) {
            return new Date(a.time) - new Date(b.time);
        });
        trainsAtStations[sig].sameDestination.sort(function(a, b) {
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
                        
                        // Get unique train numbers from other trains
                        var uniqueTrainNumbers = Array.from(new Set(
                            otherTrains.map(function(t) { return t.AdvertisedTrainIdent; })
                        )).filter(function(num) { return num !== trainNumber; });
                        
                        if (uniqueTrainNumbers.length > 0) {
                            // Fetch GPS positions for all other trains
                            var trainNumberFilters = uniqueTrainNumbers.map(function(num) {
                                return '<EQ name="Train.AdvertisedTrainNumber" value="' + escapeXml(num) + '" />';
                            }).join('');
                            
                            var positionsQuery = `
                                <QUERY objecttype="TrainPosition" schemaversion="1.1">
                                    <FILTER>
                                        <OR>
                                            ${trainNumberFilters}
                                        </OR>
                                    </FILTER>
                                    <INCLUDE>Train.AdvertisedTrainNumber</INCLUDE>
                                    <INCLUDE>Position.WGS84</INCLUDE>
                                    <INCLUDE>Speed</INCLUDE>
                                    <INCLUDE>TimeStamp</INCLUDE>
                                </QUERY>
                            `;
                            
                            TrafikverketAPI.request(positionsQuery)
                                .then(function(posData) {
                                    var positions = posData.RESPONSE?.RESULT?.[0]?.TrainPosition || [];
                                    var trainPositions = {};
                                    positions.forEach(function(pos) {
                                        if (pos.Train && pos.Train.AdvertisedTrainNumber) {
                                            trainPositions[pos.Train.AdvertisedTrainNumber] = pos;
                                        }
                                    });
                                    
                                    classifyAndStoreTrains(trainNumber, announcements, otherTrains, trainPositions);
                                    processTrainData(trainNumber, announcements, orderedRoute, trainPosition);
                                })
                                .catch(function() {
                                    // GPS data is optional, continue without it
                                    classifyAndStoreTrains(trainNumber, announcements, otherTrains, {});
                                    processTrainData(trainNumber, announcements, orderedRoute, trainPosition);
                                });
                        } else {
                            classifyAndStoreTrains(trainNumber, announcements, otherTrains, {});
                            processTrainData(trainNumber, announcements, orderedRoute, trainPosition);
                        }
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
    
    // Sort order constants for via stations
    var VIA_TO_SORT_ORDER_BASE = 1;      // ViaToLocations come right after parent
    var VIA_FROM_SORT_ORDER_BASE = 1000; // ViaFromLocations come late in segment
    
    sortedAnnounced.forEach(function(station, index) {
        // Get previous announced station's time for ViaFromLocation sorting
        var prevAnnouncedTime = index > 0 ? sortedAnnounced[index - 1].advertisedTime : null;
        
        if (station.viaFromLocations && station.viaFromLocations.length > 0) {
            const sortedVia = station.viaFromLocations.slice().sort(function(a, b) {
                return (a.Order || 0) - (b.Order || 0);
            });
            
            sortedVia.forEach(function(via, viaIndex) {
                // Skip if this is an announced station (will be added with proper time later)
                // Note: via.LocationName is a station signature (e.g., "Em", "Lu") in the Trafikverket API,
                // which matches the announcementMap key (ann.LocationSignature)
                if (announcementMap[via.LocationName]) {
                    return;
                }
                if (!addedLocations.has(via.LocationName)) {
                    addedLocations.add(via.LocationName);
                    stations.push({
                        signature: via.LocationName,
                        isAnnounced: false,
                        departed: false,
                        arrived: false,
                        isCurrent: false,
                        // ViaFromLocations come after ViaToLocations of previous station
                        // Use high order number to place them later in the segment
                        _sortTime: prevAnnouncedTime,
                        _sortOrder: VIA_FROM_SORT_ORDER_BASE + viaIndex
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
            
            sortedVia.forEach(function(via, viaIndex) {
                // Skip if this is an announced station (will be added with proper time later)
                // Note: via.LocationName is a station signature (e.g., "Em", "Lu") in the Trafikverket API,
                // which matches the announcementMap key (ann.LocationSignature)
                if (announcementMap[via.LocationName]) {
                    return;
                }
                if (!addedLocations.has(via.LocationName)) {
                    addedLocations.add(via.LocationName);
                    stations.push({
                        signature: via.LocationName,
                        isAnnounced: false,
                        departed: false,
                        arrived: false,
                        isCurrent: false,
                        // ViaToLocations come right after parent announced station
                        // Use low order number to place them early in the segment
                        _sortTime: station.advertisedTime,
                        _sortOrder: VIA_TO_SORT_ORDER_BASE + viaIndex
                    });
                }
            });
        }
    });
    
    // Sort stations by advertised time (earliest → latest)
    // Via stations use their parent's time for sorting
    stations.sort(function(a, b) {
        var timeA = a.advertisedTime || a._sortTime;
        var timeB = b.advertisedTime || b._sortTime;
        
        if (timeA && timeB) {
            var dateA = new Date(timeA);
            var dateB = new Date(timeB);
            
            // If same time, use sort order (announced stations with order 0 come before via stations with order > 0)
            if (dateA.getTime() === dateB.getTime()) {
                var orderA = a._sortOrder || 0;
                var orderB = b._sortOrder || 0;
                return orderA - orderB;
            }
            
            return dateA - dateB;
        }
        
        // Fallback: keep original order
        return 0;
    });
    
    // Clean up temporary sort fields
    for (var j = 0; j < stations.length; j++) {
        delete stations[j]._sortTime;
        delete stations[j]._sortOrder;
    }
    
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
    
    // NEW: Reverse the order so end station is at top
    var reversedStations = stations.slice().reverse();
    var reversedCurrentIndex = currentIndex >= 0 ? stations.length - 1 - currentIndex : -1;
    
    reversedStations.forEach(function(station, index) {
        const $row = $('<tr>');
        
        // Calculate original index for hasPassed check
        var originalIndex = stations.length - 1 - index;
        
        const isCurrent = station.isCurrent;
        const inTransitZone = station.inTransitZone;
        const hasPassed = station.isAnnounced && (originalIndex < currentIndex || station.departed);
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
                const delay = formatDelay(station.advertisedTime, station.actualTime);
                const $delaySpan = $('<span>').addClass('delay-info');
                
                // Color coding
                if (delay === 'I tid') {
                    $delaySpan.addClass('on-time').text(' (' + delay + ')');
                } else if (delay.startsWith('+')) {
                    $delaySpan.addClass('delayed').text(' (' + delay + ')');
                } else {
                    $delaySpan.addClass('early').text(' (' + delay + ')');
                }
                
                $timeSpan.append($delaySpan);
            }
            $trainCell.append($timeSpan);
        }
        
        // Show other trains from the same origin (left column)
        var trainsData = window.trainData.trainsAtStations || {};
        var stationTrains = trainsData[station.signature];
        
        if (stationTrains && stationTrains.sameOrigin) {
            stationTrains.sameOrigin.forEach(function(train) {
                var delay = formatDelay(train.time, train.actualTime);
                
                // Create clickable link for train number
                var $trainLink = $('<a>')
                    .attr('href', 'https://search.stationen.info/train.html?train=' + train.trainNumber)
                    .attr('target', '_blank')
                    .attr('rel', 'noopener noreferrer')
                    .text(train.trainNumber);
                
                // Get destination signature for the train
                var destinationSignature = train.destinationSignature || '?';
                
                var $trainSpan = $('<div>')
                    .addClass('train-item same-origin')
                    .append($trainLink)
                    .append(' ' + destinationSignature + ' (' + delay + ')');
                
                $trainCell.append($trainSpan);
            });
        }
        
        $row.append($trainCell);
        
        // Column 3 - Trains to the same destination (right column)
        const $meetCell = $('<td>').addClass('meeting-cell');
        
        if (stationTrains && stationTrains.sameDestination) {
            stationTrains.sameDestination.forEach(function(train) {
                var delay = formatDelay(train.time, train.actualTime);
                
                // Create clickable link for train number
                var $trainLink = $('<a>')
                    .attr('href', 'https://search.stationen.info/train.html?train=' + train.trainNumber)
                    .attr('target', '_blank')
                    .attr('rel', 'noopener noreferrer')
                    .text(train.trainNumber);
                
                // Get destination signature for the train
                var destinationSignature = train.destinationSignature || '?';
                
                var $trainSpan = $('<div>')
                    .addClass('train-item same-destination')
                    .append($trainLink)
                    .append(' ' + destinationSignature + ' (' + delay + ')');
                
                $meetCell.append($trainSpan);
            });
        }
        
        $row.append($meetCell);
        
        $tbody.append($row);
    });
    
    // Auto-scroll to current train position (using reversed index)
    if (reversedCurrentIndex >= 0) {
        setTimeout(function() {
            var $currentRow = $('#table-body tr').eq(reversedCurrentIndex);
            if ($currentRow.length > 0) {
                $currentRow[0].scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            }
        }, 100);
    }
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