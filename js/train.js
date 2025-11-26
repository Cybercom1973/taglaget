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
    
    $.ajax({
        url: '/api/train/' + trainNumber + '/full-route',
        method: 'GET',
        success: function(response) {
            if (response.announcements && response.announcements.length > 0) {
                const stationNames = {};
                if (response.allLocations) {
                    response.allLocations.forEach(function(station) {
                        stationNames[station.LocationSignature] = station.AdvertisedLocationName;
                    });
                }
                window.trainData.stationNames = stationNames;
                
                processTrainData(trainNumber, response.announcements, response.orderedRoute, response.trainPosition);
            } else {
                showError('Tåg ' + trainNumber + ' hittades inte för idag');
            }
        },
        error: function(xhr, status, error) {
            console.error('API Error:', error);
            showError('Fel vid hämtning av tågdata: ' + error);
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
        
        $row.append($trainCell);
        
        const $meetCell = $('<td>').addClass('meeting-cell');
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