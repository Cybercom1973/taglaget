$(document).ready(function() {
    const urlParams = new URLSearchParams(window.location.search);
    const trainNumber = urlParams.get('train');
    
    if (!trainNumber) {
        window.location.href = 'index.html';
        return;
    }
    
    $('#train-label').text('Tåg ' + trainNumber);
    
    // Store train data globally
    window.trainData = {
        trainNumber: trainNumber,
        schedule: [],
        currentPosition: null,
        direction: null
    };
    
    // Initialize
    loadTrainData(trainNumber);
    
    // Refresh button
    $('#refresh-btn').on('click', function() {
        loadTrainData(trainNumber);
    });
    
    // Auto-refresh every 30 seconds
    setInterval(function() {
        loadTrainData(trainNumber);
    }, 30000);
});

function loadTrainData(trainNumber) {
    $('#loading').show();
    $('#error-message').hide();
    $('#train-table').hide();
    
    // Fetch train schedule from API
    $.ajax({
        url: '/api/train/' + trainNumber,
        method: 'GET',
        success: function(response) {
            if (response.RESPONSE && response.RESPONSE.RESULT && response.RESPONSE.RESULT[0]) {
                const announcements = response.RESPONSE.RESULT[0].TrainAnnouncement || [];
                
                if (announcements.length === 0) {
                    showError('Tåg ' + trainNumber + ' hittades inte för idag');
                    return;
                }
                
                processTrainData(trainNumber, announcements);
            } else {
                showError('Kunde inte hämta tågdata');
            }
        },
        error: function(xhr, status, error) {
            console.error('API Error:', error);
            showError('Fel vid hämtning av tågdata: ' + error);
        }
    });
}

function processTrainData(trainNumber, announcements) {
    // Group by location and sort by time
    const stationMap = {};
    let direction = null;
    
    // Determine train direction from first and last station
    const departures = announcements.filter(a => a.ActivityType === 'Avgang');
    if (departures.length > 0) {
        const firstStation = departures[0];
        const lastStation = departures[departures.length - 1];
        
        if (firstStation.ToLocation && firstStation.ToLocation.length > 0) {
            direction = firstStation.ToLocation[0].LocationName;
        }
    }
    
    // Process all announcements to build station list
    announcements.forEach(function(announcement) {
        const location = announcement.LocationSignature;
        
        if (!stationMap[location]) {
            stationMap[location] = {
                signature: location,
                advertisedTime: announcement.AdvertisedTimeAtLocation,
                actualTime: announcement.TimeAtLocation || null,
                track: announcement.TrackAtLocation || '',
                activityType: announcement.ActivityType,
                departed: false,
                arrived: false,
                isCurrent: false
            };
        }
        
        // Update with arrival/departure info
        if (announcement.ActivityType === 'Ankomst') {
            stationMap[location].arrived = !!announcement.TimeAtLocation;
            stationMap[location].arrivalTime = announcement.TimeAtLocation;
        }
        if (announcement.ActivityType === 'Avgang') {
            stationMap[location].departed = !!announcement.TimeAtLocation;
            stationMap[location].departureTime = announcement.TimeAtLocation;
            stationMap[location].track = announcement.TrackAtLocation || stationMap[location].track;
        }
    });
    
    // Convert to array and sort by advertised time
    const stations = Object.values(stationMap).sort(function(a, b) {
        return new Date(a.advertisedTime) - new Date(b.advertisedTime);
    });
    
    // Find current position (last station where train has departed or arrived but not departed next)
    let currentIndex = -1;
    for (let i = 0; i < stations.length; i++) {
        if (stations[i].departed || stations[i].arrived) {
            currentIndex = i;
        }
    }
    
    // Mark current position
    if (currentIndex >= 0) {
        // If departed from this station, train is between this and next
        if (stations[currentIndex].departed && currentIndex < stations.length - 1) {
            stations[currentIndex].trainBetweenHereAndNext = true;
        } else {
            stations[currentIndex].isCurrent = true;
        }
    }
    
    window.trainData.schedule = stations;
    window.trainData.currentPosition = currentIndex >= 0 ? stations[currentIndex] : null;
    window.trainData.direction = direction;
    
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
        
        // Determine if this is where the train currently is
        const isCurrent = station.isCurrent;
        const isBetween = station.trainBetweenHereAndNext;
        const hasPassed = index < currentIndex || station.departed;
        const isUpcoming = index > currentIndex && !station.departed && !station.arrived;
        
        // Column 1: Station signature
        const $stationCell = $('<td>').addClass('station-cell').text(station.signature);
        if (hasPassed) {
            $stationCell.addClass('passed-station');
        }
        $row.append($stationCell);
        
        // Column 2: Train position and track
        const $trainCell = $('<td>').addClass('same-direction-cell');
        
        if (isCurrent) {
            // Train is at this station
            const trackInfo = station.track ? station.signature + ' ' + station.track : station.signature;
            const $trainSpan = $('<div>')
                .addClass('train-item current-train')
                .text(trainNumber + ' ' + trackInfo);
            $trainCell.append($trainSpan);
        } else if (isBetween) {
            // Train has left this station, show it between rows
            $row.after(createBetweenRow(trainNumber, station));
        }
        
        // Show scheduled time
        if (station.advertisedTime) {
            const time = formatTime(station.advertisedTime);
            const $timeSpan = $('<div>')
                .addClass('scheduled-time')
                .text(time);
            if (station.actualTime) {
                const actualTime = formatTime(station.actualTime);
                $timeSpan.append($('<span>').addClass('actual-time').text(' (' + actualTime + ')'));
            }
            $trainCell.append($timeSpan);
        }
        
        $row.append($trainCell);
        
        // Column 3: Meeting trains (placeholder - requires additional API call)
        const $meetCell = $('<td>').addClass('meeting-cell');
        $row.append($meetCell);
        
        $tbody.append($row);
    });
}

function createBetweenRow(trainNumber, fromStation) {
    const $row = $('<tr>').addClass('between-row');
    $row.append($('<td>').addClass('station-cell').text(''));
    
    const $trainCell = $('<td>').addClass('same-direction-cell');
    const $trainSpan = $('<div>')
        .addClass('train-item current-train')
        .text(trainNumber + ' (på väg)');
    $trainCell.append($trainSpan);
    $row.append($trainCell);
    
    $row.append($('<td>').addClass('meeting-cell'));
    
    return $row;
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