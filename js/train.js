// --- HJÄLPFUNKTIONER ---

function escapeXml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[m]));
}

function parseDate(dateStr) {
    if (!dateStr) return null;
    return new Date(dateStr);
}

function getDiffMinutes(advertisedStr, actualStr) {
    const adv = parseDate(advertisedStr);
    const act = parseDate(actualStr);
    if (!adv || !act) return 0;
    return Math.round((act - adv) / 60000);
}

function formatDelay(diff) {
    if (isNaN(diff) || diff === 0) return 'I tid';
    return (diff > 0 ? '+' : '') + diff + ' min';
}

// NYTT: Robust funktion för att hitta destination
function getBestDestination(ann) {
    // 1. Prioritera huvud-destinationen (ToLocation)
    if (ann.ToLocation && ann.ToLocation.length > 0) {
        return ann.ToLocation[0].LocationName;
    }
    // 2. Fallback: Ta sista stationen i Via-listan
    if (ann.ViaToLocation && ann.ViaToLocation.length > 0) {
        return ann.ViaToLocation[ann.ViaToLocation.length - 1].LocationName;
    }
    return "?";
}

// Hitta slutstation för ditt tåg (för rubriken)
function findDestinationSignature(announcements) {
    for (const ann of announcements) {
        const dest = getBestDestination(ann);
        if (dest !== "?") return dest;
    }
    return "?";
}

// --- BYGG RUTT ---
function buildRoute(announcements) {
    if (!announcements || announcements.length === 0) return [];

    const stationMap = new Map();

    announcements.forEach(ann => {
        if (!stationMap.has(ann.LocationSignature)) {
            stationMap.set(ann.LocationSignature, {
                signature: ann.LocationSignature,
                isAnnounced: false,
                advertised: null,
                actual: null,
                track: null,
                sortTime: 0,
                technicalIdent: null
            });
        }
        
        const node = stationMap.get(ann.LocationSignature);

        if (ann.Advertised === true) node.isAnnounced = true;

        if (ann.AdvertisedTimeAtLocation) {
            const t = parseDate(ann.AdvertisedTimeAtLocation).getTime();
            if (node.sortTime === 0 || ann.ActivityType === 'Avgang') {
                node.sortTime = t;
                node.advertised = ann.AdvertisedTimeAtLocation;
            }
        }

        if (ann.TimeAtLocation) node.actual = ann.TimeAtLocation;
        if (ann.TrackAtLocation) node.track = ann.TrackAtLocation;
        if (ann.TechnicalTrainIdent) node.technicalIdent = ann.TechnicalTrainIdent;
    });

    const route = Array.from(stationMap.values());
    route.sort((a, b) => a.sortTime - b.sortTime);

    // Vänd listan: Mål överst
    return route.reverse();
}

// --- HUVUDPROGRAM ---

$(document).ready(function() {
    const urlParams = new URLSearchParams(window.location.search);
    const trainNumber = urlParams.get('train');

    if (trainNumber) {
        loadTrain(trainNumber);
        setInterval(() => loadTrain(trainNumber), 60000);
        $('#refresh-btn').off('click').on('click', () => loadTrain(trainNumber));
    } else {
        $('#train-label').text('Inget tåg valt');
    }
});

function loadTrain(trainNumber) {
    $('#loading').show();
    $('#train-table').hide();
    $('#error-message').hide();
    
    const safeTrainNum = escapeXml(trainNumber);
    
    TrafikverketAPI.getTrainAnnouncements(safeTrainNum)
        .then(data => {
            if (!data || !data.RESPONSE || !data.RESPONSE.RESULT || !data.RESPONSE.RESULT[0]) {
                throw new Error("Ogiltigt svar från Trafikverket.");
            }

            const resultItem = data.RESPONSE.RESULT[0];
            const announcements = resultItem.TrainAnnouncement || [];
            
            if (announcements.length === 0) {
                const today = new Date().toLocaleDateString('sv-SE');
                throw new Error(`Inga tåg hittades med nummer ${trainNumber} för datum ${today}.`);
            }
            
            const techIdent = announcements[0].TechnicalTrainIdent || trainNumber;
            $('#train-label').text('Tåg ' + techIdent);
            
            const route = buildRoute(announcements);
            const signatures = route.map(r => r.signature);
            const myDestSig = findDestinationSignature(announcements);

            return TrafikverketAPI.getOtherTrains(signatures).then(otherData => {
                let otherTrains = [];
                if (otherData && otherData.RESPONSE && otherData.RESPONSE.RESULT && otherData.RESPONSE.RESULT[0]) {
                    otherTrains = otherData.RESPONSE.RESULT[0].TrainAnnouncement || [];
                }
                
                renderTable(route, otherTrains, trainNumber, myDestSig);
                
                $('#loading').hide();
                $('#train-table').show();
                $('#last-update').text('Uppdaterad: ' + new Date().toLocaleTimeString('sv-SE'));
            });
        })
        .catch(err => {
            $('#loading').hide();
            $('#error-message').text(err.message).show();
            console.error(err);
        });
}

function renderTable(route, otherTrains, mySearchIdent, myDestSig) {
    const $tbody = $('#table-body');
    $tbody.empty();
    
    // 1. Hitta min position
    let currentPosIndex = -1;
    let dynamicTechnicalIdent = mySearchIdent;

    for (let i = 0; i < route.length; i++) {
        if (route[i].actual) {
            currentPosIndex = i;
            if (route[i].technicalIdent) dynamicTechnicalIdent = route[i].technicalIdent;
            break; 
        }
    }
    $('#train-label').text('Tåg ' + dynamicTechnicalIdent);

    // 2. Index-karta
    const routeIndexMap = new Map();
    route.forEach((node, idx) => {
        routeIndexMap.set(node.signature, idx);
    });

    // 3. FÖRBEHANDLA OCH FILTRERA ANDRA TÅG
    const now = new Date();
    const latestMap = new Map();

    // A. Hitta SENASTE händelsen för varje tåg
    otherTrains.forEach(t => {
        if (t.AdvertisedTrainIdent === mySearchIdent) return;
        if (!t.TimeAtLocation) return;
        
        const id = t.TechnicalTrainIdent || t.AdvertisedTrainIdent;
        const newTime = parseDate(t.TimeAtLocation).getTime();
        
        if (!latestMap.has(id) || newTime > parseDate(latestMap.get(id).TimeAtLocation).getTime()) {
            latestMap.set(id, t);
        }
    });
    
    // B. Applicera filtret "Spöktåg"
    const activeOtherTrains = [];
    const hideStationaryMinutes = parseInt(localStorage.getItem('taglaget_hideStationaryMinutes')) || 30;

    latestMap.forEach(t => {
        const ageMinutes = Math.abs((now - parseDate(t.TimeAtLocation)) / 60000);
        
        // REGEL 1: Avgång -> Visa vid senaste kända position (ta bort 1-minutsregeln)
        // Tåg som avgått visas nu vid sin senaste kända driftplats
        
        // REGEL 2: Ankomst -> Konfigurerbar tid (Står inne)
        if (t.ActivityType === 'Ankomst' && ageMinutes > hideStationaryMinutes) return;
        
        // REGEL 3: Om det står på slutstationen -> Dölj (Det har parkerat)
        const dest = getBestDestination(t);
        if (t.ActivityType === 'Ankomst' && t.LocationSignature === dest) return;

        activeOtherTrains.push(t);
    });

    // Samla driftplatser från andra tåg som inte finns i rutten
    const routeSignatures = new Set(route.map(r => r.signature));
    const missingStations = new Map();

    activeOtherTrains.forEach(t => {
        const sig = t.LocationSignature;
        if (!routeSignatures.has(sig) && !missingStations.has(sig)) {
            missingStations.set(sig, {
                signature: sig,
                isAnnounced: false,
                advertised: t.AdvertisedTimeAtLocation,
                actual: t.TimeAtLocation,
                track: t.TrackAtLocation,
                sortTime: parseDate(t.TimeAtLocation).getTime(),
                technicalIdent: null,
                isExternalStation: true // Markera som extern driftplats
            });
        }
    });

    // Lägg till saknade driftplatser i rutten, sorterade baserat på tid
    let displayRoute = route;
    if (missingStations.size > 0) {
        const allStations = [...route, ...missingStations.values()];
        // Sortera baserat på sortTime (omvänd ordning, mål överst)
        allStations.sort((a, b) => b.sortTime - a.sortTime);
        displayRoute = allStations;
        
        // Uppdatera currentPosIndex efter att externa stationer lagts till
        currentPosIndex = displayRoute.findIndex(s => 
            route.find(r => r.signature === s.signature && r.actual)
        );
        if (currentPosIndex === -1) {
            // Fallback: hitta första station med actual
            for (let i = 0; i < displayRoute.length; i++) {
                if (displayRoute[i].actual && !displayRoute[i].isExternalStation) {
                    currentPosIndex = i;
                    break;
                }
            }
        }
    }

    // Begränsa antal trafikplatser som visas
    const maxStations = parseInt(localStorage.getItem('taglaget_maxStations')) || 0;

    if (maxStations > 0 && currentPosIndex >= 0) {
        const halfWindow = Math.floor(maxStations / 2);
        let startIdx = Math.max(0, currentPosIndex - halfWindow);
        let endIdx = Math.min(route.length, startIdx + maxStations);
        
        if (endIdx === route.length) {
            startIdx = Math.max(0, endIdx - maxStations);
        }
        
        displayRoute = route.slice(startIdx, endIdx);
        currentPosIndex = currentPosIndex - startIdx;
    }

    // 4. RENDERA
    displayRoute.forEach((station, index) => {
        
        // Mellanrum
        if (index === currentPosIndex && index > 0) {
            const $spacer = $('<tr>').addClass('spacer-row');
            const $td = $('<td>').attr('colspan', '3');
            const diff = getDiffMinutes(station.advertised, station.actual);
            const colorClass = diff > 0 ? 'delayed' : 'on-time';
            const $myTrain = $('<div>').addClass('current-train-box');
            $myTrain.html(`⬆ ${dynamicTechnicalIdent} ${myDestSig} <span class="${colorClass}">(${formatDelay(diff)})</span> ⬆`);
            $td.append($myTrain);
            $spacer.append($td);
            $tbody.append($spacer);
        }

        const $row = $('<tr>');
        const $stationCell = $('<td>').addClass('station-cell');
        const encodedSign = encodeURIComponent(station.signature);
        const $link = $('<a>')
            .attr('href', `station.html?sign=${encodedSign}`)
            .addClass('station-link')
            .text(station.signature);
        
        $stationCell.append($link);
        if (!station.isAnnounced) $stationCell.addClass('unannounced-station');
        if (station.isExternalStation) $stationCell.addClass('external-station');
        if (index === currentPosIndex && index === 0) $stationCell.addClass('current-position-glow');
        $row.append($stationCell);
        
        
        const trainsHere = activeOtherTrains.filter(t => t.LocationSignature === station.signature);
        const sameDirectionTrains = [];
        const meetingTrains = [];

        trainsHere.forEach(t => {
            let isSameDir = false; 
            let isDiverging = false;

            // Destinationer
            let targets = [];
            if (t.ToLocation) t.ToLocation.forEach(l => targets.push(l.LocationName));
            if (t.ViaToLocation) t.ViaToLocation.forEach(l => targets.push(l.LocationName));
            // Fallback-destination
            const fallbackDest = getBestDestination(t);
            if (fallbackDest !== "?") targets.push(fallbackDest);

            // Ursprung
            let origins = [];
            if (t.FromLocation) t.FromLocation.forEach(l => origins.push(l.LocationName));
            if (t.ViaFromLocation) t.ViaFromLocation.forEach(l => origins.push(l.LocationName));

            const goingToMyFuture = targets.some(sig => {
                const idx = routeIndexMap.get(sig);
                return idx !== undefined && idx < index;
            });

            const comingFromMyPast = origins.some(sig => {
                const idx = routeIndexMap.get(sig);
                return idx !== undefined && idx > index;
            });

            const goingToMyPast = targets.some(sig => {
                const idx = routeIndexMap.get(sig);
                return idx !== undefined && idx > index;
            });

            if (goingToMyFuture) {
                isSameDir = true;
            } else if (goingToMyPast) {
                isSameDir = false;
            } else if (comingFromMyPast) {
                isSameDir = true;
                isDiverging = true;
            } else {
                if (targets.includes(myDestSig)) isSameDir = true;
                else isSameDir = false;
            }

            t._isDiverging = isDiverging;

            if (isSameDir) sameDirectionTrains.push(t);
            else meetingTrains.push(t);
        });

        const $sameDirCell = $('<td>').addClass('same-direction-cell');
        sameDirectionTrains.forEach(t => $sameDirCell.append(createTrainElement(t)));

        if (index === currentPosIndex && index === 0) {
            const diff = getDiffMinutes(station.advertised, station.actual);
            const colorClass = diff > 0 ? 'delayed' : 'on-time';
            const $myTrain = $('<div>').addClass('current-train-box');
            $myTrain.html(`🏁 ${dynamicTechnicalIdent} ${myDestSig} <span class="${colorClass}">(${formatDelay(diff)})</span>`);
            $sameDirCell.append($myTrain);
        }
        $row.append($sameDirCell);

        const $meetDirCell = $('<td>').addClass('meeting-cell');
        meetingTrains.forEach(t => $meetDirCell.append(createTrainElement(t)));
        $row.append($meetDirCell);
        
        $tbody.append($row);
    });
    
    if (currentPosIndex >= 0) {
        setTimeout(() => {
            const $target = $('.spacer-row').length ? $('.spacer-row') : $('#table-body tr').eq(0);
            if ($target.length) $target[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    }
}

function createTrainElement(t) {
    const id = t.TechnicalTrainIdent || t.AdvertisedTrainIdent;
    const searchId = t.AdvertisedTrainIdent;
    const diff = getDiffMinutes(t.AdvertisedTimeAtLocation, t.TimeAtLocation);
    const colorClass = diff > 0 ? 'delayed' : 'on-time';
    
    let dest = getBestDestination(t);
    if (dest !== "?") dest = " " + dest;
    else dest = "";
    
    const divergeIcon = t._isDiverging ? " ↱" : "";

    const $div = $('<div>').addClass('train-item');
    const $link = $('<a>').attr('href', `?train=${searchId}`).text(id + dest + divergeIcon);
    
    $div.append($link);
    $div.append(` <span class="${colorClass}">(${formatDelay(diff)})</span>`);
    
    return $div;
}
