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

// Determine train direction based on ToLocation and FromLocation from API
function determineTrainDirection(trainAnnouncements) {
    if (!trainAnnouncements || trainAnnouncements.length === 0) return null;
    
    // Find first announcement with ToLocation (destination)
    var toLocation = null;
    var fromLocation = null;
    for (var i = 0; i < trainAnnouncements.length; i++) {
        if (trainAnnouncements[i].ToLocation && trainAnnouncements[i].ToLocation[0] && !toLocation) {
            toLocation = trainAnnouncements[i].ToLocation[0].LocationName;
        }
        if (trainAnnouncements[i].FromLocation && trainAnnouncements[i].FromLocation[0] && !fromLocation) {
            fromLocation = trainAnnouncements[i].FromLocation[0].LocationName;
        }
        if (toLocation && fromLocation) break;
    }
    
    // Get first and last station signatures for destination display
    var sorted = trainAnnouncements.slice().sort(function(a, b) {
        return new Date(a.AdvertisedTimeAtLocation) - new Date(b.AdvertisedTimeAtLocation);
    });
    var last = sorted[sorted.length - 1];
    var first = sorted[0];
    
    // Get ordered station signatures from announcements
    var stationOrder = sorted.map(function(ann) {
        return ann.LocationSignature;
    });
    
    return {
        toLocation: toLocation,
        fromLocation: fromLocation,
        to: last.LocationSignature,  // Keep for destination display
        from: first.LocationSignature,  // First station signature
        stationOrder: stationOrder  // Ordered list of stations for direction comparison
    };
}

// Helper function to compare direction between two trains based on station order
// Returns: 'same' if same direction, 'opposite' if opposite direction, 'unknown' if cannot determine
function compareDirectionByStationOrder(currentTrainStations, otherTrainStations) {
    if (!currentTrainStations || currentTrainStations.length < 2) return 'unknown';
    if (!otherTrainStations || otherTrainStations.length < 2) return 'unknown';
    
    // Find shared stations between the trains
    var sharedStations = [];
    for (var i = 0; i < otherTrainStations.length; i++) {
        var station = otherTrainStations[i];
        var currentIndex = currentTrainStations.indexOf(station);
        if (currentIndex !== -1) {
            sharedStations.push({
                station: station,
                currentIndex: currentIndex,
                otherIndex: i
            });
        }
    }
    
    // Need at least 2 shared stations to determine direction
    if (sharedStations.length < 2) return 'unknown';
    
    // Sort by currentIndex to get them in order of current train's route
    sharedStations.sort(function(a, b) {
        return a.currentIndex - b.currentIndex;
    });
    
    // Compare the order of stations between the two trains
    var sameDirectionCount = 0;
    var oppositeDirectionCount = 0;
    
    for (var j = 0; j < sharedStations.length - 1; j++) {
        var first = sharedStations[j];
        var second = sharedStations[j + 1];
        
        // In current train: first comes before second (currentIndex order)
        // Check if same is true for other train
        if (first.otherIndex < second.otherIndex) {
            sameDirectionCount++;
        } else {
            oppositeDirectionCount++;
        }
    }
    
    if (sameDirectionCount > oppositeDirectionCount) {
        return 'same';
    } else if (oppositeDirectionCount > sameDirectionCount) {
        return 'opposite';
    }
    return 'unknown';
}

// Check if two trains are going in the same direction based on station order
function hasSameDirectionByStationOrder(currentTrainStations, otherTrainStations) {
    return compareDirectionByStationOrder(currentTrainStations, otherTrainStations) === 'same';
}

// Check if two trains are going in opposite directions based on station order
function hasOppositeDirectionByStationOrder(currentTrainStations, otherTrainStations) {
    return compareDirectionByStationOrder(currentTrainStations, otherTrainStations) === 'opposite';
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
    
    // Calculate time window: only trains passed within the last 10 minutes
    var now = new Date();
    var recentTimeLimit = new Date(now.getTime() - 10 * 60000); // 10 min ago
    
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
        
        // Filter: Only show trains that passed within the last 10 minutes
        var passedTime = new Date(currentPosition.actualTime);
        
        if (passedTime >= recentTimeLimit) {
            // Passed within 10 min → show it ✅
            trainCurrentPositions[trainNum] = currentPosition;
        }
        // Otherwise: too old, don't show ❌
    });
    
    // Then: Add each train ONLY at its current position
    var trainsAtStations = {};
    
    Object.keys(trainCurrentPositions).forEach(function(trainNum) {
        var position = trainCurrentPositions[trainNum];
        var stationSig = position.station;
        
        if (!trainsAtStations[stationSig]) {
            trainsAtStations[stationSig] = {
                sameDirection: [],      // Left column: same direction (same origin)
                oppositeDirection: []   // Right column: opposite direction (meeting trains)
            };
        }
        
        var trainDirection = determineTrainDirection(trainsByNumber[trainNum]);
        
        // Get destination signature from trainDirection
        var destinationSignature = trainDirection ? trainDirection.to : '?';
        
        var trainInfo = {
            trainNumber: trainNum,
            time: position.time,
            actualTime: position.actualTime,
            track: position.track,
            destinationSignature: destinationSignature
        };
        
        // Get station orders for comparison
        var currentStationOrder = currentDirection ? currentDirection.stationOrder : [];
        var otherStationOrder = trainDirection ? trainDirection.stationOrder : [];
        
        // Classify using station-based direction comparison
        if (hasSameDirectionByStationOrder(currentStationOrder, otherStationOrder)) {
            // Left column: Trains going in the SAME direction (based on station order)
            trainsAtStations[stationSig].sameDirection.push(trainInfo);
        } else if (hasOppositeDirectionByStationOrder(currentStationOrder, otherStationOrder)) {
            // Right column: Trains going in OPPOSITE direction (based on station order)
            trainsAtStations[stationSig].oppositeDirection.push(trainInfo);
        }
        // If neither, the train is not shown (not enough shared stations to determine direction)
    });
    
    // Sort trains by time
    Object.keys(trainsAtStations).forEach(function(sig) {
        trainsAtStations[sig].sameDirection.sort(function(a, b) {
            return new Date(a.time) - new Date(b.time);
        });
        trainsAtStations[sig].oppositeDirection.sort(function(a, b) {
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
            var announcements = [];
            if (announcementData.RESPONSE && announcementData.RESPONSE.RESULT && 
                announcementData.RESPONSE.RESULT[0] && announcementData.RESPONSE.RESULT[0].TrainAnnouncement) {
                announcements = announcementData.RESPONSE.RESULT[0].TrainAnnouncement;
            }
            
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
                <QUERY objecttype="TrainPosition" schemaversion="1.1" namespace="järnväg.trafikinfo">
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
                    var trainPosition = null;
                    if (positionData.RESPONSE && positionData.RESPONSE.RESULT && 
                        positionData.RESPONSE.RESULT[0] && positionData.RESPONSE.RESULT[0].TrainPosition &&
                        positionData.RESPONSE.RESULT[0].TrainPosition[0]) {
                        trainPosition = positionData.RESPONSE.RESULT[0].TrainPosition[0];
                    }
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
    // Store announcements in window.trainData for use in renderTrainTable
    window.trainData.announcements = announcements;
    
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
                var stations = [];
                if (stationData.RESPONSE && stationData.RESPONSE.RESULT && 
                    stationData.RESPONSE.RESULT[0] && stationData.RESPONSE.RESULT[0].TrainStation) {
                    stations = stationData.RESPONSE.RESULT[0].TrainStation;
                }
                
                var stationNames = {};
                stations.forEach(function(station) {
                    stationNames[station.LocationSignature] = station.AdvertisedLocationName;
                });
                window.trainData.stationNames = stationNames;
                
                // Now fetch other trains
                TrafikverketAPI.request(otherTrainsQuery)
                    .then(function(otherTrainsData) {
                        var otherTrains = [];
                        if (otherTrainsData.RESPONSE && otherTrainsData.RESPONSE.RESULT && 
                            otherTrainsData.RESPONSE.RESULT[0] && otherTrainsData.RESPONSE.RESULT[0].TrainAnnouncement) {
                            otherTrains = otherTrainsData.RESPONSE.RESULT[0].TrainAnnouncement;
                        }
                        
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
                                <QUERY objecttype="TrainPosition" schemaversion="1.1" namespace="järnväg.trafikinfo">
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
                                    var positions = [];
                                    if (posData.RESPONSE && posData.RESPONSE.RESULT && 
                                        posData.RESPONSE.RESULT[0] && posData.RESPONSE.RESULT[0].TrainPosition) {
                                        positions = posData.RESPONSE.RESULT[0].TrainPosition;
                                    }
                                    
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
                        _sortTime: station.advertisedTime,
                        _sortOrder: VIA_TO_SORT_ORDER_BASE + viaIndex
                    });
                }
            });
        }
    });
    
    // Sort stations by advertised time (earliest → latest)
    stations.sort(function(a, b) {
        var timeA = a.advertisedTime || a._sortTime;
        var timeB = b.advertisedTime || b._sortTime;
        
        if (timeA && timeB) {
            var dateA = new Date(timeA);
            var dateB = new Date(timeB);
            
            if (dateA.getTime() === dateB.getTime()) {
                var orderA = a._sortOrder || 0;
                var orderB = b._sortOrder || 0;
                return orderA - orderB;
            }
            
            return dateA - dateB;
        }
        
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
    
    // Get final station signature (last station in the original array)
    var finalStation = stations.length > 0 ? stations[stations.length - 1].signature : '?';
    
    // Reverse the order so end station is at top
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
            // Display: trainNumber finalStation (Diff)
            var delay = formatDelay(station.advertisedTime, station.actualTime);
            const $trainSpan = $('<div>')
                .addClass('train-item current-train')
                .text(trainNumber + ' ' + finalStation + ' (' + delay + ')');
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
        
        // Show trains going in same direction (left column) - without time
        var trainsData = window.trainData.trainsAtStations || {};
        var stationTrains = trainsData[station.signature];
        
        if (stationTrains && stationTrains.sameDirection) {
            stationTrains.sameDirection.forEach(function(train) {
                var delay = formatDelay(train.time, train.actualTime);
                
                var $trainLink = $('<a>')
                    .attr('href', 'train.html?train=' + train.trainNumber)
                    .attr('target', '_blank')
                    .attr('rel', 'noopener noreferrer')
                    .text(train.trainNumber);
                
                var destinationSignature = train.destinationSignature || '?';
                
                // Left column: train number + destination + delay (NO time)
                var $trainSpan = $('<div>')
                    .addClass('train-item same-direction')
                    .append($trainLink)
                    .append(' ' + destinationSignature + ' (' + delay + ')');
                
                $trainCell.append($trainSpan);
            });
        }
        
        $row.append($trainCell);
        
        // Column 3 - Trains going in opposite direction (right column) - without time
        const $meetCell = $('<td>').addClass('meeting-cell');
        
        if (stationTrains && stationTrains.oppositeDirection) {
            stationTrains.oppositeDirection.forEach(function(train) {
                var delay = formatDelay(train.time, train.actualTime);
                
                var $trainLink = $('<a>')
                    .attr('href', 'train.html?train=' + train.trainNumber)
                    .attr('target', '_blank')
                    .attr('rel', 'noopener noreferrer')
                    .text(train.trainNumber);
                
                var destinationSignature = train.destinationSignature || '?';
                
                // Right column: train number + destination + delay (NO time)
                var $trainSpan = $('<div>')
                    .addClass('train-item opposite-direction')
                    .append($trainLink)
                    .append(' ' + destinationSignature + ' (' + delay + ')');
                
                $meetCell.append($trainSpan);
            });
        }
        
        $row.append($meetCell);
        
        // Check if train is between this station and next (add spacer row)
        if (station.trainBetweenHereAndNext) {
            $tbody.append($row); // Append current station row first
            
            // Create empty spacer row with train indicator
            const $spacerRow = $('<tr>').addClass('spacer-row');
            const $spacerCell1 = $('<td>').addClass('spacer-cell').html('&nbsp;');
            const $spacerCell2 = $('<td>').addClass('spacer-cell');
            const $trainHereSpan = $('<div>')
                .addClass('train-item train-in-transit')
                .text('🚂 ' + trainNumber + ' →');
            $spacerCell2.append($trainHereSpan);
            const $spacerCell3 = $('<td>').addClass('spacer-cell').html('&nbsp;');
            
            $spacerRow.append($spacerCell1, $spacerCell2, $spacerCell3);
            $tbody.append($spacerRow);
            
            return; // Skip normal append at the end since we already added the row
        }
        
        $tbody.append($row);
    });
    
    // Auto-scroll to current train position
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
