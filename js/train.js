$(document).ready(function() {
    const urlParams = new URLSearchParams(window.location.search);
    const trainNumber = urlParams.get('train');
    
    if (!trainNumber) {
        window.location.href = 'index.html';
        return;
    }
    
    $('#train-label').text('Tåg ' + trainNumber);
    
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
    
    // For demo purposes, using mock data
    // Replace with actual API calls when backend is ready
    
    setTimeout(function() {
        renderTrainTable(trainNumber, getMockData(trainNumber));
        $('#loading').hide();
        updateLastRefresh();
    }, 500);
}

function getMockData(trainNumber) {
    // Mock data based on the image
    return {
        currentTrain: trainNumber,
        stations: [
            { signature: 'Bdf', name: 'Borlänge', sameDirection: [], meeting: [] },
            { signature: 'Gt', name: 'Gävle', sameDirection: [], meeting: [] },
            { signature: 'N', name: 'Nässjö', sameDirection: [
                { train: '49543', track: 'Gsh 14', type: 'same' },
                { train: '27657', track: 'N 1', type: 'same' }
            ], meeting: [
                { train: '528', track: 'Cst 22', type: 'meeting' }
            ]},
            { signature: 'Gmp', name: 'Gmp', sameDirection: [], meeting: [
                { train: '6342', track: 'Gmp 15', type: 'meeting' }
            ]},
            { signature: 'Vim', name: 'Vim', sameDirection: [], meeting: [] },
            { signature: 'Fls', name: 'Fls', sameDirection: [], meeting: [] },
            { signature: 'Any', name: 'Any', sameDirection: [], meeting: [] },
            { signature: 'Ras', name: 'Ras', sameDirection: [], meeting: [] },
            { signature: '', name: '', sameDirection: [
                { train: '27609', track: 'N 0', type: 'same' }
            ], meeting: [
                { train: '20013', track: 'Fok 12', type: 'meeting' }
            ]},
            { signature: 'Frd', name: 'Frd', sameDirection: [], meeting: [] },
            { signature: '', name: '', sameDirection: [
                { train: trainNumber, track: 'Phm 107', type: 'current' }
            ], meeting: [] },
            { signature: 'Gp', name: 'Gp', sameDirection: [], meeting: [] },
            { signature: '', name: '', sameDirection: [
                { train: '35613', track: 'Mgb 22', type: 'same' }
            ], meeting: [] },
            { signature: 'Tns', name: 'Tns', sameDirection: [
                { train: '18819', track: 'Tns 2', type: 'same' },
                { train: '97609', track: 'Tns 7', type: 'same' }
            ], meeting: [] },
            { signature: 'Smn', name: 'Smn', sameDirection: [], meeting: [] },
            { signature: 'Bx', name: 'Bx', sameDirection: [], meeting: [] },
            { signature: 'Lkn', name: 'Lkn', sameDirection: [], meeting: [] },
            { signature: '', name: '', sameDirection: [], meeting: [
                { train: '5360', track: 'Hrbi 35', type: 'meeting' }
            ]}
        ]
    };
}

function renderTrainTable(trainNumber, data) {
    const $tbody = $('#table-body');
    $tbody.empty();
    
    data.stations.forEach(function(station) {
        const $row = $('<tr>');
        
        // Column 1: Station
        $row.append($('<td>').addClass('station-cell').text(station.signature));
        
        // Column 2: Trains in same direction
        const $sameCell = $('<td>').addClass('same-direction-cell');
        station.sameDirection.forEach(function(train) {
            const $trainSpan = $('<div>').addClass('train-item');
            const trainText = train.train + ' ' + train.track;
            
            if (train.type === 'current') {
                $trainSpan.addClass('current-train').text(trainText);
            } else {
                $trainSpan.addClass('same-train').text(trainText);
            }
            $sameCell.append($trainSpan);
        });
        $row.append($sameCell);
        
        // Column 3: Meeting trains
        const $meetCell = $('<td>').addClass('meeting-cell');
        station.meeting.forEach(function(train) {
            const $trainSpan = $('<div>')
                .addClass('train-item meeting-train')
                .text(train.train + ' ' + train.track);
            $meetCell.append($trainSpan);
        });
        $row.append($meetCell);
        
        $tbody.append($row);
    });
}

function updateLastRefresh() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('#last-update').text('Uppdaterad: ' + timeStr);
}