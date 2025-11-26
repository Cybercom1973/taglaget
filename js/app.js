$(document).ready(function() {
    // Load recent searches from localStorage
    loadRecentSearches();
    
    // Handle search form submission
    $('#search-form').on('submit', function(e) {
        e.preventDefault();
        const trainNumber = $('#train-number').val().trim();
        
        if (trainNumber) {
            saveRecentSearch(trainNumber);
            window.location.href = `train.html?train=${encodeURIComponent(trainNumber)}`;
        } else {
            showError('Ange ett tågnummer');
        }
    });
    
    // Handle input changes
    $('#train-number').on('input', function() {
        const value = $(this).val();
        if (value.length > 0) {
            $('#clear-btn').show();
        } else {
            $('#clear-btn').hide();
        }
        $('#error-message').text('');
    });
    
    // Handle clear button
    $('#clear-btn').on('click', function() {
        $('#train-number').val('').focus();
        $(this).hide();
    });
    
    // Handle recent search clicks
    $(document).on('click', '.recent-item', function() {
        const trainNumber = $(this).data('train');
        window.location.href = `train.html?train=${encodeURIComponent(trainNumber)}`;
    });
    
    // Handle delete recent search
    $(document).on('click', '.delete-recent', function(e) {
        e.stopPropagation();
        const trainNumber = $(this).closest('.recent-item').data('train');
        deleteRecentSearch(trainNumber);
    });
});

function showError(message) {
    $('#error-message').text(message);
}

function loadRecentSearches() {
    const searches = getRecentSearches();
    const $list = $('#recent-list');
    $list.empty();
    
    if (searches.length === 0) {
        $('#recent-searches').hide();
        return;
    }
    
    $('#recent-searches').show();
    searches.forEach(function(train) {
        $list.append(`
            <li class="recent-item" data-train="${train}">
                <span class="recent-train">🚂 Tåg ${train}</span>
                <button class="delete-recent">✕</button>
            </li>
        `);
    });
}

function getRecentSearches() {
    const searches = localStorage.getItem('recentTrainSearches');
    return searches ? JSON.parse(searches) : [];
}

function saveRecentSearch(trainNumber) {
    let searches = getRecentSearches();
    // Remove if already exists
    searches = searches.filter(s => s !== trainNumber);
    // Add to beginning
    searches.unshift(trainNumber);
    // Keep only last 10
    searches = searches.slice(0, 10);
    localStorage.setItem('recentTrainSearches', JSON.stringify(searches));
}

function deleteRecentSearch(trainNumber) {
    let searches = getRecentSearches();
    searches = searches.filter(s => s !== trainNumber);
    localStorage.setItem('recentTrainSearches', JSON.stringify(searches));
    loadRecentSearches();
}