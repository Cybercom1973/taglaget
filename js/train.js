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
// Helper function to process Via stations and add them to the route
function processViaStations(viaStations, addedLocations, allLocations) {
    if (!viaStations || viaStations.length === 0) return;
    
    var sortedVia = viaStations.slice().sort(function(a, b) {
        return (a.Order || 0) - (b.Order || 0);
    });
    sortedVia.forEach(function(via) {
        if (!addedLocations.has(via.LocationName)) {
            addedLocations.add(via.LocationName);
            allLocations.push({
                signature: via.LocationName,
                isAnnounced: false
            });
        }
    });
}

// Build complete route including Via stations for a train's announcements
function buildCompleteRoute(announcements) {
    var allLocations = [];
    var addedLocations = new Set();
    
    // Sort by advertised time
    var sorted = announcements.slice().sort(function(a, b) {
        return new Date(a.AdvertisedTimeAtLocation) - new Date(b.AdvertisedTimeAtLocation);
    });
    
    sorted.forEach(function(ann) {
        // Add ViaFromLocation (locations before this announced station)
        processViaStations(ann.ViaFromLocation, addedLocations, allLocations);
        
        // Add the announced location
        if (!addedLocations.has(ann.LocationSignature)) {
            addedLocations.add(ann.LocationSignature);
            allLocations.push({
                signature: ann.LocationSignature,
                isAnnounced: true,
                advertisedTime: ann.AdvertisedTimeAtLocation,
                actualTime: ann.TimeAtLocation,
                track: ann.TrackAtLocation
            });
        }
        
        // Add ViaToLocation (locations after this announced station)
        processViaStations(ann.ViaToLocation, addedLocations, allLocations);
    });
    
    return allLocations;
}

// Find the latest operational station (driftplats) for a train including Via stations
function findLatestOperationalStation(announcements, completeRoute) {
    // Sort announcements by advertised time
    var sorted = announcements.slice().sort(function(a, b) {
        return new Date(a.AdvertisedTimeAtLocation) - new Date(b.AdvertisedTimeAtLocation);
    });
    
    // Find the latest station with TimeAtLocation (actually passed)
    var latestPassedIndex = -1;
    var latestPassedAnnouncement = null;
    
    for (var i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i].TimeAtLocation) {
            latestPassedAnnouncement = sorted[i];
            break;
        }
    }
    
    if (!latestPassedAnnouncement) {
        return null; // Train hasn't passed any station yet
    }
    
    // Find the index of this station in the complete route
    var passedStationIndex = -1;
    for (var j = 0; j < completeRoute.length; j++) {
        if (completeRoute[j].signature === latestPassedAnnouncement.LocationSignature) {
            passedStationIndex = j;
            break;
        }
    }
    
    // The latest operational station is either:
    // 1. The announced station if the train is still there (arrived but not departed)
    // 2. The next Via station if the train has departed to an unannounced station
    
    // Check if train has departed from the last passed announced station
    var hasDeparted = false;
    for (var k = 0; k < sorted.length; k++) {
        if (sorted[k].LocationSignature === latestPassedAnnouncement.LocationSignature &&
            sorted[k].ActivityType === 'Avgang' && sorted[k].TimeAtLocation) {
            hasDeparted = true;
            break;
        }
    }
    
    // If departed and there's a Via station next, the train is at that Via station
    if (hasDeparted && passedStationIndex >= 0 && passedStationIndex < completeRoute.length - 1) {
        var nextStation = completeRoute[passedStationIndex + 1];
        if (!nextStation.isAnnounced) {
            // Train is likely at this unannounced (Via) station
            return {
                station: nextStation.signature,
                isViaStation: true,
                previousAnnouncedStation: latestPassedAnnouncement.LocationSignature,
                time: latestPassedAnnouncement.AdvertisedTimeAtLocation,
                actualTime: latestPassedAnnouncement.TimeAtLocation
            };
        }
    }
    
    // Otherwise, return the announced station
    return {
        station: latestPassedAnnouncement.LocationSignature,
        isViaStation: false,
        time: latestPassedAnnouncement.AdvertisedTimeAtLocation,
        actualTime: latestPassedAnnouncement.TimeAtLocation,
        track: latestPassedAnnouncement.TrackAtLocation
    };
}

function classifyAndStoreTrains(currentTrainNumber, currentAnnouncements, allOtherTrains, trainGPSPositions) {
    var currentDirection = determineTrainDirection(currentAnnouncements);
    
    // Build complete route for current train including Via stations
    var currentCompleteRoute = buildCompleteRoute(currentAnnouncements);
    var currentRouteSignatures = currentCompleteRoute.map(function(loc) { return loc.signature; });
    // Use Set for O(1) lookup when filtering trains by route membership
    var currentRouteSet = new Set(currentRouteSignatures);
    
    // Calculate time window: only trains passed within the last 10 minutes
    var now = new Date();
    var recentTimeLimit = new Date(now.getTime() - 10 * 60000); // 10 min ago
    
    // Group all trains by train number (AdvertisedTrainIdent)
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
        
        // Guard: skip if no announcements (defensive)
        if (!announcements || announcements.length === 0) return;
        
        // Sort by time
        var sorted = announcements.slice().sort(function(a, b) {
            return new Date(a.AdvertisedTimeAtLocation) - new Date(b.AdvertisedTimeAtLocation);
        });
        
        // Get TechnicalTrainIdent from first announcement
        var technicalTrainIdent = announcements[0].TechnicalTrainIdent || trainNum;
        
        // Build complete route for this train including Via stations
        var completeRoute = buildCompleteRoute(announcements);
        
        // Find the latest operational station (including Via stations)
        var latestOperational = findLatestOperationalStation(announcements, completeRoute);
        
        if (!latestOperational) return; // Train hasn't passed any station yet
        
        // Find LATEST station with TimeAtLocation (actually passed) for timing info
        var currentPosition = null;
        for (var i = sorted.length - 1; i >= 0; i--) {
            if (sorted[i].TimeAtLocation) {
                currentPosition = {
                    station: latestOperational.station,  // Use the determined operational station (includes Via stations)
                    announcedStation: sorted[i].LocationSignature,  // The actual announced station
                    isViaStation: latestOperational.isViaStation,
                    time: sorted[i].AdvertisedTimeAtLocation,
                    actualTime: sorted[i].TimeAtLocation,
                    track: sorted[i].TrackAtLocation,
                    technicalTrainIdent: technicalTrainIdent,
                    completeRoute: completeRoute  // Store complete route for display
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
        var stationSig = position.station;  // This is now the operational station (may include Via)
        
        // Filter: Only show trains whose latest driftplats is on the current train's route
        // This ensures we only display trains operating on our route segment
        if (!currentRouteSet.has(stationSig)) {
            return; // Skip trains not on current train's route
        }
        
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
            trainNumber: trainNum,  // AdvertisedTrainIdent - for search links
            technicalTrainIdent: position.technicalTrainIdent || trainNum,  // For display
            time: position.time,
            actualTime: position.actualTime,
            track: position.track,
            destinationSignature: destinationSignature,
            latestDriftplats: position.station,  // The latest operational station (driftplats)
            isViaStation: position.isViaStation,  // Whether the train is at a Via (unannounced) station
            completeRoute: position.completeRoute  // Complete route including Via stations
        };
        
        // Get station orders for comparison - use complete route including Via stations
        var currentStationOrder = currentRouteSignatures;
        var otherStationOrder = [];
        if (position.completeRoute) {
            otherStationOrder = position.completeRoute.map(function(loc) { return loc.signature; });
        } else if (trainDirection && trainDirection.stationOrder) {
            otherStationOrder = trainDirection.stationOrder;
        }
        
        // Classify using station-based direction comparison
        var directionResult = compareDirectionByStationOrder(currentStationOrder, otherStationOrder);
        
        if (directionResult === 'same') {
            // Left column: Trains going in the SAME direction (based on station order)
            trainsAtStations[stationSig].sameDirection.push(trainInfo);
        } else if (directionResult === 'opposite') {
            // Right column: Trains going in OPPOSITE direction (based on station order)
            trainsAtStations[stationSig].oppositeDirection.push(trainInfo);
        } else {
            // Direction unknown (not enough shared stations) - show in same direction column by default
            // This ensures all trains on our route are visible, even if heading to different destinations
            trainsAtStations[stationSig].sameDirection.push(trainInfo);
        }
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

// Helper function to get yesterday's date string
function getYesterdayDate() {
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
}

// Helper function to extract station signatures from announcements (including Via stations)
function extractStationSignatures(announcements) {
    var stations = [];
    var addedStations = new Set();
    
    // Sort by advertised time
    var sorted = announcements.slice().sort(function(a, b) {
        return new Date(a.AdvertisedTimeAtLocation) - new Date(b.AdvertisedTimeAtLocation);
    });
    
    sorted.forEach(function(ann) {
        // Add ViaFromLocation (locations before this announced station)
        if (ann.ViaFromLocation && ann.ViaFromLocation.length > 0) {
            var sortedViaFrom = ann.ViaFromLocation.slice().sort(function(a, b) {
                return (a.Order || 0) - (b.Order || 0);
            });
            sortedViaFrom.forEach(function(via) {
                if (!addedStations.has(via.LocationName)) {
                    addedStations.add(via.LocationName);
                    stations.push({
                        signature: via.LocationName,
                        isAnnounced: false,
                        isFromYesterday: true
                    });
                }
            });
        }
        
        // Add the announced location
        if (!addedStations.has(ann.LocationSignature)) {
            addedStations.add(ann.LocationSignature);
            stations.push({
                signature: ann.LocationSignature,
                isAnnounced: true,
                isFromYesterday: true
            });
        }
        
        // Add ViaToLocation (locations after this announced station)
        if (ann.ViaToLocation && ann.ViaToLocation.length > 0) {
            var sortedViaTo = ann.ViaToLocation.slice().sort(function(a, b) {
                return (a.Order || 0) - (b.Order || 0);
            });
            sortedViaTo.forEach(function(via) {
                if (!addedStations.has(via.LocationName)) {
                    addedStations.add(via.LocationName);
                    stations.push({
                        signature: via.LocationName,
                        isAnnounced: false,
                        isFromYesterday: true
                    });
                }
            });
        }
    });
    
    return stations;
}

// Helper function to build today's station list from announcements (including Via stations)
function buildTodayStationList(announcements) {
    var stations = [];
    var addedStations = new Set();
    
    // Sort by advertised time
    var sorted = announcements.slice().sort(function(a, b) {
        return new Date(a.AdvertisedTimeAtLocation) - new Date(b.AdvertisedTimeAtLocation);
    });
    
    sorted.forEach(function(ann) {
        // Add ViaFromLocation (locations before this announced station)
        processViaStations(ann.ViaFromLocation, addedStations, stations);
        
        // Add the announced location
        if (!addedStations.has(ann.LocationSignature)) {
            addedStations.add(ann.LocationSignature);
            stations.push({
                signature: ann.LocationSignature,
                isAnnounced: true,
                advertisedTime: ann.AdvertisedTimeAtLocation,
                actualTime: ann.TimeAtLocation,
                track: ann.TrackAtLocation,
                activityType: ann.ActivityType
            });
        }
        
        // Add ViaToLocation (locations after this announced station)
        processViaStations(ann.ViaToLocation, addedStations, stations);
    });
    
    return stations;
}

// Use yesterday's exact timetable order as the master sequence
// Today's train data is overlaid onto yesterday's station order - no re-sorting!
function mergeRoutesWithYesterdayOrder(yesterdayStations, todayStations) {
    // If no yesterday data, just return today's stations in their order
    if (!yesterdayStations || yesterdayStations.length === 0) {
        return todayStations.map(function(station) {
            return {
                signature: station.signature,
                isAnnounced: station.isAnnounced,
                advertisedTime: station.advertisedTime,
                actualTime: station.actualTime,
                track: station.track,
                activityType: station.activityType
            };
        });
    }
    
    // If no today data, return empty array
    if (!todayStations || todayStations.length === 0) {
        return [];
    }
    
    // Build lookup map and signatures array for today's data
    var todayDataMap = {};
    todayStations.forEach(function(station) {
        todayDataMap[station.signature] = station;
    });
    var todaySignatures = todayStations.map(function(s) { return s.signature; });
    
    // Use yesterday's exact station order as the master list
    // Simply iterate through yesterday's stations in order and update with today's data where available
    var mergedRoute = [];
    var addedStations = new Set();
    
    // Iterate through yesterday's stations in exact timetable order (first to last)
    yesterdayStations.forEach(function(yStation) {
        var sig = yStation.signature;
        
        if (!addedStations.has(sig)) {
            addedStations.add(sig);
            
            if (todayDataMap[sig] !== undefined) {
                // Use today's data for this station
                var todayData = todayDataMap[sig];
                mergedRoute.push({
                    signature: sig,
                    isAnnounced: todayData.isAnnounced,
                    advertisedTime: todayData.advertisedTime,
                    actualTime: todayData.actualTime,
                    track: todayData.track,
                    activityType: todayData.activityType
                });
            } else {
                // Station from yesterday's route (not in today's announcements)
                // Mark as isFromYesterday so we know it's part of the historical route
                mergedRoute.push({
                    signature: sig,
                    isAnnounced: yStation.isAnnounced === true ? true : false,
                    isFromYesterday: true
                });
            }
        }
    });
    
    // Build a signature-to-index map for inserting any new today stations
    var mergedRouteIndexMap = {};
    mergedRoute.forEach(function(station, idx) {
        mergedRouteIndexMap[station.signature] = idx;
    });
    
    // Add any today stations that weren't in yesterday's route
    // Insert them at the correct position based on their neighbors in today's list
    todayStations.forEach(function(tStation) {
        var sig = tStation.signature;
        if (!addedStations.has(sig)) {
            // This station is new (not in yesterday's route)
            // Find the best position to insert it based on neighboring stations
            
            // Find the index of this station in today's list
            var todayIdx = todaySignatures.indexOf(sig);
            
            // Look for the previous station in today's list that exists in merged route
            var insertAfterIdx = -1;
            for (var i = todayIdx - 1; i >= 0; i--) {
                var prevSig = todaySignatures[i];
                if (mergedRouteIndexMap[prevSig] !== undefined) {
                    insertAfterIdx = mergedRouteIndexMap[prevSig];
                    break;
                }
            }
            
            var newStation = {
                signature: sig,
                isAnnounced: tStation.isAnnounced,
                advertisedTime: tStation.advertisedTime,
                actualTime: tStation.actualTime,
                track: tStation.track,
                activityType: tStation.activityType
            };
            
            if (insertAfterIdx !== -1) {
                // Insert after the found station
                mergedRoute.splice(insertAfterIdx + 1, 0, newStation);
                // Update the index map for all stations after the insertion point
                mergedRoute.forEach(function(s, i) {
                    mergedRouteIndexMap[s.signature] = i;
                });
            } else {
                // No previous station found, add at the beginning
                mergedRoute.unshift(newStation);
                // Rebuild the index map
                mergedRoute.forEach(function(s, i) {
                    mergedRouteIndexMap[s.signature] = i;
                });
            }
            
            addedStations.add(sig);
        }
    });
    
    return mergedRoute;
}

function loadTrainData(trainNumber) {
    $('#loading').show();
    $('#error-message').hide();
    $('#train-table').hide();
    
    var today = new Date().toISOString().split('T')[0];
    var yesterday = getYesterdayDate();
    var escapedTrainNumber = escapeXml(trainNumber);
    
    // Step 1: Fetch yesterday's announcements to get the complete historical route
    var yesterdayQuery = `
        <QUERY objecttype="TrainAnnouncement" schemaversion="1.6" orderby="AdvertisedTimeAtLocation">
        <FILTER>
            <AND>
                <EQ name="AdvertisedTrainIdent" value="${escapedTrainNumber}" />
                <EQ name="ScheduledDepartureDateTime" value="${yesterday}" />
            </AND>
        </FILTER>
            <INCLUDE>ActivityType</INCLUDE>
            <INCLUDE>AdvertisedTimeAtLocation</INCLUDE>
            <INCLUDE>AdvertisedTrainIdent</INCLUDE>
            <INCLUDE>LocationSignature</INCLUDE>
            <INCLUDE>ViaFromLocation</INCLUDE>
            <INCLUDE>ViaToLocation</INCLUDE>
        </QUERY>
    `;
    
    // Step 2: Get today's train announcements with ViaLocations
    var todayQuery = `
        <QUERY objecttype="TrainAnnouncement" schemaversion="1.6" orderby="AdvertisedTimeAtLocation">
        <FILTER>
            <AND>
                <EQ name="AdvertisedTrainIdent" value="${escapedTrainNumber}" />
                <EQ name="ScheduledDepartureDateTime" value="${today}" />
            </AND>
        </FILTER>
            <INCLUDE>ActivityType</INCLUDE>
            <INCLUDE>AdvertisedTimeAtLocation</INCLUDE>
            <INCLUDE>AdvertisedTrainIdent</INCLUDE>
            <INCLUDE>TechnicalTrainIdent</INCLUDE>
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
    
    // Fetch yesterday's data first, then today's data
    TrafikverketAPI.request(yesterdayQuery)
        .then(function(yesterdayData) {
            var yesterdayAnnouncements = [];
            if (yesterdayData.RESPONSE && yesterdayData.RESPONSE.RESULT && 
                yesterdayData.RESPONSE.RESULT[0] && yesterdayData.RESPONSE.RESULT[0].TrainAnnouncement) {
                yesterdayAnnouncements = yesterdayData.RESPONSE.RESULT[0].TrainAnnouncement;
            }
            
            // Extract station signatures from yesterday's announcements
            var yesterdayStations = extractStationSignatures(yesterdayAnnouncements);
            
            // Now fetch today's announcements
            return TrafikverketAPI.request(todayQuery)
                .then(function(todayData) {
                    return {
                        yesterdayStations: yesterdayStations,
                        todayData: todayData
                    };
                });
        })
        .catch(function(error) {
            // If yesterday's fetch fails, log and continue with today's data only
            console.log('Could not fetch yesterday\'s announcements:', error ? error.message : 'Unknown error');
            return TrafikverketAPI.request(todayQuery)
                .then(function(todayData) {
                    return {
                        yesterdayStations: [],
                        todayData: todayData
                    };
                });
        })
        .then(function(result) {
            var yesterdayStations = result.yesterdayStations;
            var announcementData = result.todayData;
            
            var announcements = [];
            if (announcementData.RESPONSE && announcementData.RESPONSE.RESULT && 
                announcementData.RESPONSE.RESULT[0] && announcementData.RESPONSE.RESULT[0].TrainAnnouncement) {
                announcements = announcementData.RESPONSE.RESULT[0].TrainAnnouncement;
            }
            
            if (announcements.length === 0) {
                showError('Tåg ' + trainNumber + ' hittades inte för idag');
                return;
            }
            
            // Extract TechnicalTrainIdent from first announcement for display
            var technicalTrainIdent = announcements[0].TechnicalTrainIdent || trainNumber;
            window.trainData.technicalTrainIdent = technicalTrainIdent;
            
            // Update train label to show TechnicalTrainIdent
            $('#train-label').text('Tåg ' + technicalTrainIdent);
            
            // Step 3: Build today's station list and merge with yesterday's route order
            // Yesterday's route provides the master sequence for station ordering
            var todayStations = buildTodayStationList(announcements);
            var orderedLocations = mergeRoutesWithYesterdayOrder(yesterdayStations, todayStations);
            
            // Collect all location signatures for station name lookup
            var allLocationSignatures = new Set();
            orderedLocations.forEach(function(loc) {
                allLocationSignatures.add(loc.signature);
            });
            
            // Step 4: Try to get train position (optional)
            var positionQuery = `
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
                <INCLUDE>TechnicalTrainIdent</INCLUDE>
                <INCLUDE>LocationSignature</INCLUDE>
                <INCLUDE>ToLocation</INCLUDE>
                <INCLUDE>FromLocation</INCLUDE>
                <INCLUDE>ViaFromLocation</INCLUDE>
                <INCLUDE>ViaToLocation</INCLUDE>
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
    // Store announcements first to ensure data is available for renderTrainTable
    window.trainData.announcements = announcements;
    
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
                viaToLocations: announcement.ViaToLocation || [],
                technicalTrainIdent: announcement.TechnicalTrainIdent || trainNumber
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
            // Update TechnicalTrainIdent from departure announcement if available
            if (announcement.TechnicalTrainIdent) {
                announcementMap[location].technicalTrainIdent = announcement.TechnicalTrainIdent;
            }
        }
    });
    
    const stations = [];
    const addedLocations = new Set();
    
    // Build stations array by iterating orderedRoute in order (don't re-sort!)
    // orderedRoute already contains the correct merged list of stations (yesterday's + today's)
    // in the proper order. Re-sorting by AdvertisedTimeAtLocation would break the ordering
    // because yesterday's stations have dates from 1 day ago while today's have today's dates.
    if (orderedRoute && orderedRoute.length > 0) {
        orderedRoute.forEach(function(loc) {
            if (addedLocations.has(loc.signature)) {
                return; // Skip duplicates
            }
            addedLocations.add(loc.signature);
            
            // Check if we have announcement data for this station
            var annData = announcementMap[loc.signature];
            
            if (annData) {
                // Station has announcement data - use it
                stations.push(annData);
            } else if (loc.isFromYesterday) {
                // Yesterday's station without today's announcement data
                stations.push({
                    signature: loc.signature,
                    isAnnounced: loc.isAnnounced || false,
                    isFromYesterday: true,
                    departed: true,  // Yesterday's stations are already passed
                    arrived: true,   // Yesterday's stations are already passed
                    isCurrent: false,
                    advertisedTime: null,
                    actualTime: null,
                    track: '',
                    activityType: null
                });
            } else {
                // Via station (unannounced) from today's route
                stations.push({
                    signature: loc.signature,
                    isAnnounced: false,
                    departed: false,
                    arrived: false,
                    isCurrent: false,
                    advertisedTime: null,
                    actualTime: null,
                    track: '',
                    activityType: null
                });
            }
        });
    }
    
    let currentIndex = -1;
    for (let i = 0; i < stations.length; i++) {
        // Skip yesterday's stations - only use today's announcements for current position
        if (stations[i].isFromYesterday) {
            continue;
        }
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
        
        // Update TechnicalTrainIdent based on current position
        // Use the OTN from the current segment (station where train is at or last passed)
        if (stations[currentIndex].technicalTrainIdent) {
            window.trainData.technicalTrainIdent = stations[currentIndex].technicalTrainIdent;
            $('#train-label').text('Tåg ' + stations[currentIndex].technicalTrainIdent);
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
    
    // Use TechnicalTrainIdent for display (stored when loading data)
    var displayTrainNumber = window.trainData.technicalTrainIdent || trainNumber;
    
    // Get final station signature (last station in the original array)
    var finalStation = stations.length > 0 ? stations[stations.length - 1].signature : '?';
    
    // Find current train's latest operational station (driftplats)
    var currentTrainDriftplats = null;
    var currentTrainInfo = null;
    
    // Look for the current train's position
    for (var i = stations.length - 1; i >= 0; i--) {
        if (stations[i].isCurrent || stations[i].inTransitZone || stations[i].trainBetweenHereAndNext) {
            if (stations[i].isCurrent) {
                currentTrainDriftplats = stations[i].signature;
                currentTrainInfo = {
                    station: stations[i],
                    isInTransit: false
                };
            } else if (stations[i].inTransitZone) {
                // Train is in transit zone - use this Via station as driftplats
                currentTrainDriftplats = stations[i].signature;
                currentTrainInfo = {
                    station: stations[i],
                    isInTransit: true,
                    isViaStation: !stations[i].isAnnounced
                };
            } else if (stations[i].trainBetweenHereAndNext) {
                // Train is between stations - find the next station as driftplats
                if (i + 1 < stations.length) {
                    currentTrainDriftplats = stations[i + 1].signature;
                    currentTrainInfo = {
                        station: stations[i + 1],
                        isInTransit: true,
                        isViaStation: !stations[i + 1].isAnnounced,
                        previousStation: stations[i].signature
                    };
                }
            }
            break;
        }
    }
    
    // Collect all driftplats from current train's route (start to end station)
    var trainsData = window.trainData.trainsAtStations || {};
    var allDriftplats = new Set();
    
    // Add ALL stations from current train's route (start to end)
    // This ensures we display every driftplats on the route, not just where trains are
    stations.forEach(function(station) {
        allDriftplats.add(station.signature);
    });
    
    // Build station maps for sorting and lookup (O(1) lookups instead of O(n) searches)
    var stationOrderMap = {};
    var stationInfoMap = {};
    stations.forEach(function(station, idx) {
        stationOrderMap[station.signature] = idx;
        stationInfoMap[station.signature] = station;
    });
    
    // Default order for stations not in the route
    var DEFAULT_STATION_ORDER = 9999;
    
    // Convert to array and sort by station order (reversed so destination is at top)
    var driftplatsArray = Array.from(allDriftplats).sort(function(a, b) {
        var orderA = stationOrderMap[a] !== undefined ? stationOrderMap[a] : DEFAULT_STATION_ORDER;
        var orderB = stationOrderMap[b] !== undefined ? stationOrderMap[b] : DEFAULT_STATION_ORDER;
        return orderB - orderA; // Reverse order (destination at top)
    });
    
    // Track which row contains the current train for auto-scroll
    var currentTrainRowIndex = -1;
    
    driftplatsArray.forEach(function(driftplatsSig, index) {
        const $row = $('<tr>');
        
        // Check if this is the current train's driftplats
        var isCurrentTrainHere = (driftplatsSig === currentTrainDriftplats);
        
        // Get station info from our route if available (O(1) lookup)
        var stationInfo = stationInfoMap[driftplatsSig] || null;
        
        var isUnannounced = stationInfo ? !stationInfo.isAnnounced : true;
        
        // Column 1: Driftplats (station signature)
        const $stationCell = $('<td>').addClass('station-cell');
        $stationCell.text(driftplatsSig);
        
        if (isUnannounced) $stationCell.addClass('unannounced-station');
        if (isCurrentTrainHere) {
            $stationCell.addClass('transit-zone');
            currentTrainRowIndex = index;
        }
        
        $row.append($stationCell);
        
        // Column 2: Trains going in same direction
        const $trainCell = $('<td>').addClass('same-direction-cell');
        
        // Add current train if this is its driftplats
        if (isCurrentTrainHere && currentTrainInfo) {
            var delay = 'Ingen info';
            // Get delay from the actual announced station's time data
            if (currentTrainInfo.station && currentTrainInfo.station.advertisedTime) {
                delay = formatDelay(currentTrainInfo.station.advertisedTime, currentTrainInfo.station.actualTime);
            }
            // If train is at Via station, use the previous announced station's delay
            // departureTime is preferred because it represents when the train left the station,
            // which is the most recent known timing for a train now at an unannounced Via station
            if (delay === 'Ingen info' && currentTrainInfo.previousStation) {
                var prevStation = stationInfoMap[currentTrainInfo.previousStation];
                if (prevStation && prevStation.advertisedTime) {
                    var actualTimeAtPrevStation = prevStation.departureTime || prevStation.actualTime;
                    delay = formatDelay(prevStation.advertisedTime, actualTimeAtPrevStation);
                }
            }
            
            var viaIndicator = currentTrainInfo.isViaStation ? ' (via)' : '';
            
            const $trainSpan = $('<div>')
                .addClass('train-item current-train')
                .text(displayTrainNumber + ' ' + finalStation + viaIndicator + ' (' + delay + ')');
            $trainCell.append($trainSpan);
        }
        
        // Show other trains going in same direction at this driftplats
        var stationTrains = trainsData[driftplatsSig];
        
        if (stationTrains && stationTrains.sameDirection) {
            stationTrains.sameDirection.forEach(function(train) {
                var delay = formatDelay(train.time, train.actualTime);
                
                // Display TechnicalTrainIdent, but link uses AdvertisedTrainIdent for search
                var displayNumber = train.technicalTrainIdent || train.trainNumber;
                
                var $trainLink = $('<a>')
                    .attr('href', 'train.html?train=' + train.trainNumber)
                    .attr('target', '_blank')
                    .attr('rel', 'noopener noreferrer')
                    .text(displayNumber);
                
                var destinationSignature = train.destinationSignature || '?';
                
                // Left column: TechnicalTrainIdent + destination + delay (NO time)
                // If at Via station, add indicator
                var viaIndicator = train.isViaStation ? ' (via)' : '';
                var $trainSpan = $('<div>')
                    .addClass('train-item same-direction')
                    .append($trainLink)
                    .append(' ' + destinationSignature + viaIndicator + ' (' + delay + ')');
                
                // Add via-station class if at unannounced station
                if (train.isViaStation) {
                    $trainSpan.addClass('via-station-train');
                }
                
                $trainCell.append($trainSpan);
            });
        }
        
        $row.append($trainCell);
        
        // Column 3: Trains going in opposite direction
        const $meetCell = $('<td>').addClass('meeting-cell');
        
        if (stationTrains && stationTrains.oppositeDirection) {
            stationTrains.oppositeDirection.forEach(function(train) {
                var delay = formatDelay(train.time, train.actualTime);
                
                // Display TechnicalTrainIdent, but link uses AdvertisedTrainIdent for search
                var displayNumber = train.technicalTrainIdent || train.trainNumber;
                
                var $trainLink = $('<a>')
                    .attr('href', 'train.html?train=' + train.trainNumber)
                    .attr('target', '_blank')
                    .attr('rel', 'noopener noreferrer')
                    .text(displayNumber);
                
                var destinationSignature = train.destinationSignature || '?';
                
                // Right column: TechnicalTrainIdent + destination + delay (NO time)
                // If at Via station, add indicator
                var viaIndicator = train.isViaStation ? ' (via)' : '';
                var $trainSpan = $('<div>')
                    .addClass('train-item opposite-direction')
                    .append($trainLink)
                    .append(' ' + destinationSignature + viaIndicator + ' (' + delay + ')');
                
                // Add via-station class if at unannounced station
                if (train.isViaStation) {
                    $trainSpan.addClass('via-station-train');
                }
                
                $meetCell.append($trainSpan);
            });
        }
        
        $row.append($meetCell);
        $tbody.append($row);
    });
    
    // Auto-scroll to current train position
    if (currentTrainRowIndex >= 0) {
        setTimeout(function() {
            var $currentRow = $('#table-body tr').eq(currentTrainRowIndex);
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
