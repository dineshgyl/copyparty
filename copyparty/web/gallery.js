"use strict";

var J_GAL = 1;

var galleryData = [];
var filteredData = [];
var currentSort = 'name-asc';
var currentFolder = null;
var currentMedia = [];
var currentYear = '';
var timelineMode = false;

// Performance optimization variables
var currentPage = 0;
var pageSize = 50;
var searchDebounceTimer = null;
var searchCache = {};
var maxConcurrentRequests = 5;
var activeRequests = 0;
var requestQueue = [];

// Media file extensions
var mediaExts = {
	image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'avif', 'jxl'],
	video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg'],
	audio: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'opus', 'wma']
};

function populateYearFilter() {
	var yearFilter = ebi('yearFilter');
	if (!yearFilter) return;
	
	// Extract unique years from media files in folders
	var years = {};
	galleryData.forEach(function(item) {
		if (item.years && item.years.length > 0) {
			item.years.forEach(function(year) {
				years[year] = true;
			});
		}
	});
	
	// Sort years in descending order
	var sortedYears = Object.keys(years).sort(function(a, b) {
		return parseInt(b) - parseInt(a);
	});
	
	// Clear existing options except "All Years"
	yearFilter.innerHTML = '<option value="all">All Years</option>';
	
	// Add year options
	sortedYears.forEach(function(year) {
		var option = document.createElement('option');
		option.value = year;
		option.textContent = year;
		yearFilter.appendChild(option);
	});
}

function populateYearFilterForMedia() {
	var yearFilter = ebi('yearFilter');
	if (!yearFilter) return;
	
	// Extract unique years from current media files
	var years = {};
	var hasUnknown = false;
	
	currentMedia.forEach(function(media) {
		if (media.mtime && media.mtime > 0) {
			var year = new Date(media.mtime * 1000).getFullYear();
			years[year] = true;
		} else {
			hasUnknown = true;
		}
	});
	
	// Sort years in descending order
	var sortedYears = Object.keys(years).sort(function(a, b) {
		return parseInt(b) - parseInt(a);
	});
	
	// Clear existing options
	yearFilter.innerHTML = '<option value="all">All Years</option>';
	
	// Add year options
	sortedYears.forEach(function(year) {
		var option = document.createElement('option');
		option.value = year;
		option.textContent = year;
		yearFilter.appendChild(option);
	});
	
	// Add "Unknown" option if there are files without dates
	if (hasUnknown) {
		var option = document.createElement('option');
		option.value = 'unknown';
		option.textContent = 'Unknown Year';
		yearFilter.appendChild(option);
	}
	
	// Restore current selection if it exists in new list
	if (currentYear && currentYear !== 'all') {
		for (var i = 0; i < yearFilter.options.length; i++) {
			if (yearFilter.options[i].value === currentYear) {
				yearFilter.value = currentYear;
				break;
			}
		}
	}
}

function toggleTimelineView() {
	timelineMode = !timelineMode;
	var timelineBtn = ebi('timelineButton');
	var galleryGrid = ebi('gallery-grid');
	var timelineView = ebi('timelineView');
	
	if (timelineMode) {
		if (timelineBtn) timelineBtn.textContent = '📅 Grid View';
		if (galleryGrid) galleryGrid.style.display = 'none';
		if (timelineView) timelineView.style.display = 'block';
		// Render timeline for folders or media depending on context
		if (currentFolder) {
			renderMediaTimelineView();
		} else {
			renderTimelineView();
		}
	} else {
		if (timelineBtn) timelineBtn.textContent = '📅 Timeline';
		if (galleryGrid) galleryGrid.style.display = 'grid';
		if (timelineView) timelineView.style.display = 'none';
		// Render grid for folders or media depending on context
		if (currentFolder) {
			renderMediaView();
		} else {
			renderGallery();
		}
	}
}

function renderTimelineView() {
	var timelineView = ebi('timelineView');
	if (!timelineView) return;
	
	timelineView.innerHTML = '';
	
	if (filteredData.length === 0) {
		timelineView.innerHTML = '<div style="text-align:center;padding:40px;color:var(--fg-dim);">No folders found</div>';
		return;
	}
	
	// Group folders by media years (a folder can appear in multiple years)
	var foldersByYear = {};
	filteredData.forEach(function(item) {
		// Use media years if available, otherwise fall back to folder mtime
		var years = item.years && item.years.length > 0 ? item.years :
		            (item.mtime ? [new Date(item.mtime * 1000).getFullYear()] : ['Unknown']);
		
		// Add folder to each year it contains media from
		years.forEach(function(year) {
			if (!foldersByYear[year]) {
				foldersByYear[year] = [];
			}
			// Avoid duplicates if folder already added to this year
			if (foldersByYear[year].indexOf(item) === -1) {
				foldersByYear[year].push(item);
			}
		});
	});
	
	// Sort years in descending order
	var years = Object.keys(foldersByYear).sort(function(a, b) {
		if (a === 'Unknown') return 1;
		if (b === 'Unknown') return -1;
		return parseInt(b) - parseInt(a);
	});
	
	// Create timeline sections for each year
	years.forEach(function(year) {
		var section = document.createElement('div');
		section.className = 'timeline-year';
		
		var header = document.createElement('div');
		header.className = 'timeline-year-header';
		header.textContent = year + ' (' + foldersByYear[year].length + ' folders)';
		header.addEventListener('click', function() {
			section.classList.toggle('collapsed');
		});
		section.appendChild(header);
		
		var grid = document.createElement('div');
		grid.className = 'timeline-year-grid';
		
		foldersByYear[year].forEach(function(item) {
			var card = createGalleryCard(item);
			grid.appendChild(card);
		});
		
		section.appendChild(grid);
		timelineView.appendChild(section);
	});
}

function renderMediaTimelineView() {
	var timelineView = ebi('timelineView');
	if (!timelineView) return;
	
	timelineView.innerHTML = '';
	
	console.log('renderMediaTimelineView called, currentYear:', currentYear);
	console.log('Total media files:', currentMedia.length);
	
	// Apply filters to media
	var searchInput = ebi('search');
	var searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
	var filteredMedia = currentMedia.filter(function(media) {
		// Apply search filter
		var matchesSearch = !searchTerm || media.name.toLowerCase().indexOf(searchTerm) !== -1;
		
		// Apply year filter
		var matchesYear = !currentYear || currentYear === 'all';
		if (!matchesYear && media.mtime && media.mtime > 0) {
			var itemYear = new Date(media.mtime * 1000).getFullYear().toString();
			matchesYear = itemYear === currentYear;
		} else if (!matchesYear && (!media.mtime || media.mtime === 0)) {
			matchesYear = currentYear === 'unknown';
		}
		
		return matchesSearch && matchesYear;
	});
	
	console.log('Filtered media files:', filteredMedia.length);
	
	if (filteredMedia.length === 0) {
		timelineView.innerHTML = '<div style="text-align:center;padding:40px;color:var(--fg-dim);">No media files found</div>';
		return;
	}
	
	// Group media by year
	var mediaByYear = {};
	filteredMedia.forEach(function(media) {
		var year = (media.mtime && media.mtime > 0) ? new Date(media.mtime * 1000).getFullYear() : 'Unknown';
		if (!mediaByYear[year]) {
			mediaByYear[year] = [];
		}
		mediaByYear[year].push(media);
	});
	
	// Sort years in descending order
	var years = Object.keys(mediaByYear).sort(function(a, b) {
		if (a === 'Unknown') return 1;
		if (b === 'Unknown') return -1;
		return parseInt(b) - parseInt(a);
	});
	
	// Create timeline sections for each year
	years.forEach(function(year) {
		var section = document.createElement('div');
		section.className = 'timeline-year';
		
		var header = document.createElement('div');
		header.className = 'timeline-year-header';
		header.textContent = year + ' (' + mediaByYear[year].length + ' files)';
		header.addEventListener('click', function() {
			section.classList.toggle('collapsed');
		});
		section.appendChild(header);
		
		var grid = document.createElement('div');
		grid.className = 'timeline-year-grid';
		
		mediaByYear[year].forEach(function(media, index) {
			var card = createMediaCard(media, index);
			grid.appendChild(card);
		});
		
		section.appendChild(grid);
		timelineView.appendChild(section);
	});
}

function init() {
	setupEventListeners();
	loadGalleryData();
}

function setupEventListeners() {
	var searchInput = ebi('search');
	var sortSelect = ebi('sort');
	var yearFilter = ebi('yearFilter');
	var timelineBtn = ebi('timelineButton');
	var refreshBtn = ebi('refresh');
	var backBtn = ebi('back-btn');
	var backBottomBtn = ebi('backButtonBottom');
	var homeBtn = ebi('homeButton');
	var homeBottomBtn = ebi('homeButtonBottom');
	var scrollTopBtn = ebi('scrollToTop');

	if (searchInput) {
		searchInput.addEventListener('input', function() {
			var searchTerm = this.value;
			
			// Clear existing debounce timer
			if (searchDebounceTimer) {
				clearTimeout(searchDebounceTimer);
			}
			
			if (currentFolder) {
				// Filter media files when in folder view (no debounce needed)
				filterMedia(searchTerm);
			} else {
				// Debounce folder search (wait 300ms after user stops typing)
				searchDebounceTimer = setTimeout(function() {
					filterGalleryByFolderOrFile(searchTerm);
				}, 300);
			}
		});
	}

	if (sortSelect) {
		sortSelect.addEventListener('change', function() {
			currentSort = this.value;
			sortAndRender();
		});
	}

	if (yearFilter) {
		yearFilter.addEventListener('change', function() {
			currentYear = this.value;
			console.log('Year filter changed to:', currentYear);
			console.log('Current folder:', currentFolder);
			console.log('Timeline mode:', timelineMode);
			
			// Re-filter with the new year selection
			if (currentFolder) {
				// In subfolder view, re-filter media
				sortAndRender();
			} else {
				// In folder list view, re-filter folders
				var searchInput = ebi('search');
				var searchTerm = searchInput ? searchInput.value : '';
				filterGallery(searchTerm);
			}
		});
	}

	if (timelineBtn) {
		timelineBtn.addEventListener('click', toggleTimelineView);
	}

	if (refreshBtn) {
		refreshBtn.addEventListener('click', function() {
			if (currentFolder) {
				loadFolderMedia(currentFolder);
			} else {
				loadGalleryData();
			}
		});
	}

	if (backBtn) {
		backBtn.addEventListener('click', function(e) {
			e.preventDefault();
			showFolderList();
		});
	}

	if (backBottomBtn) {
		backBottomBtn.addEventListener('click', function(e) {
			e.preventDefault();
			showFolderList();
		});
	}

	if (homeBtn) {
		homeBtn.addEventListener('click', function() {
			window.location.href = SR + '/';
		});
	}

	if (homeBottomBtn) {
		homeBottomBtn.addEventListener('click', function() {
			window.location.href = SR + '/';
		});
	}

	if (scrollTopBtn) {
		scrollTopBtn.addEventListener('click', function() {
			window.scrollTo({ top: 0, behavior: 'smooth' });
		});
	}

	// Show/hide scroll to top button based on scroll position
	window.addEventListener('scroll', function() {
		if (scrollTopBtn) {
			if (window.pageYOffset > 300) {
				scrollTopBtn.classList.add('visible');
			} else {
				scrollTopBtn.classList.remove('visible');
			}
		}
	});
}

function loadGalleryData() {
	showLoading(true);
	currentFolder = null;
	
	var xhr = new XMLHttpRequest();
	xhr.open('GET', SR + '/?gallery=json', true);
	xhr.onload = function() {
		if (xhr.status === 200) {
			try {
				galleryData = JSON.parse(xhr.responseText);
				filteredData = galleryData.slice();
				populateYearFilter();
				sortAndRender();
			} catch (e) {
				console.error('Failed to parse gallery data:', e);
				showError('Failed to load gallery data');
			}
		} else {
			showError('Failed to load gallery data: ' + xhr.status);
		}
		showLoading(false);
	};
	xhr.onerror = function() {
		showError('Network error while loading gallery data');
		showLoading(false);
	};
	xhr.send();
}

function loadFolderMedia(folderPath) {
	showLoading(true);
	currentFolder = folderPath;
	
	// Build proper URL - use ls=j parameter instead of ?j
	var path = folderPath || '';
	// Remove leading slash if present since SR already has it
	if (path.startsWith('/')) {
		path = path.substring(1);
	}
	// Remove trailing slash
	if (path.endsWith('/')) {
		path = path.substring(0, path.length - 1);
	}
	
	var xhr = new XMLHttpRequest();
	// Build URL properly - if path is empty, just use SR
	var url = path ? (SR + '/' + path + '/?ls=j') : (SR + '/?ls=j');
	console.log('Loading folder:', url);
	console.log('Original folderPath:', folderPath);
	console.log('Processed path:', path);
	
	xhr.open('GET', url, true);
	xhr.onload = function() {
		console.log('Response status:', xhr.status);
		console.log('Response first 200 chars:', xhr.responseText.substring(0, 200));
		if (xhr.status === 200) {
			try {
				var data = JSON.parse(xhr.responseText);
				console.log('Folder data:', data);
				currentMedia = [];
				
				// The response format might be different - check both formats
				var files = data.files || data;
				if (Array.isArray(files)) {
					files.forEach(function(file) {
						var fname = file.name || file.href || file;
						if (typeof fname !== 'string') return;
						
						var ext = fname.split('.').pop().toLowerCase();
						var isImage = mediaExts.image.indexOf(ext) !== -1;
						var isVideo = mediaExts.video.indexOf(ext) !== -1;
						var isAudio = mediaExts.audio.indexOf(ext) !== -1;
						
						if (isImage || isVideo || isAudio) {
							// Build proper URLs - use encodeURI for path components
							var basePath = path ? ('/' + path) : '';
							var fileUrl = SR + basePath + '/' + fname;
							// Generate thumbnails for images and videos
							var thumbUrl = (isImage || isVideo) ? (SR + basePath + '/' + fname + '?th=j') : null;
							
							currentMedia.push({
								name: fname,
								size: file.sz || file.size || 0,
								mtime: file.ts || file.mtime || 0,
								type: isImage ? 'image' : (isVideo ? 'video' : 'audio'),
								url: fileUrl,
								thumb: thumbUrl
							});
						}
					});
				}
				
				console.log('Found media files:', currentMedia.length);
				
				// Enable timeline view by default when entering a folder
				timelineMode = true;
				var timelineBtn = ebi('timelineButton');
				if (timelineBtn) timelineBtn.textContent = '📅 Grid View';
				
				renderMediaView();
			} catch (e) {
				console.error('Failed to parse folder data:', e);
				console.error('Response text:', xhr.responseText.substring(0, 500));
				showError('Failed to load folder contents: ' + e.message);
			}
		} else {
			console.error('HTTP error:', xhr.status);
			console.error('Response:', xhr.responseText.substring(0, 500));
			showError('Failed to load folder: ' + xhr.status + ' - ' + xhr.statusText);
		}
		showLoading(false);
	};
	xhr.onerror = function() {
		console.error('Network error');
		showError('Network error while loading folder');
		showLoading(false);
	};
	xhr.send();
}

function showFolderList() {
	currentFolder = null;
	currentMedia = [];
	timelineMode = false;
	currentPage = 0;
	
	// Clear media filter cache
	window.originalMedia = null;
	
	// Clear search cache when going back
	searchCache = {};
	
	var backBtn = ebi('back-btn');
	var backBottomBtn = ebi('backButtonBottom');
	var searchInput = ebi('search');
	var sortSelect = ebi('sort');
	var yearFilter = ebi('yearFilter');
	var timelineBtn = ebi('timelineButton');
	var timelineView = ebi('timelineView');
	var galleryGrid = ebi('gallery-grid');
	
	if (backBtn) backBtn.style.display = 'none';
	if (backBottomBtn) backBottomBtn.style.display = 'none';
	if (searchInput) {
		searchInput.style.display = 'block';
		searchInput.value = ''; // Clear search when going back
	}
	if (sortSelect) sortSelect.style.display = 'block';
	if (yearFilter) yearFilter.style.display = 'block';
	if (timelineBtn) timelineBtn.style.display = 'inline-block';
	if (timelineView) timelineView.style.display = 'none';
	if (galleryGrid) galleryGrid.style.display = 'grid';
	
	sortAndRender();
}

function filterGalleryByFolderOrFile(searchTerm) {
	searchTerm = searchTerm.toLowerCase().trim();
	
	console.log('filterGalleryByFolderOrFile called with:', searchTerm);
	
	if (!searchTerm) {
		// No search term, just apply year filter
		console.log('Empty search, calling filterGallery');
		filterGallery('');
		return;
	}
	
	// Search across all folders and their files
	var matchingFolders = [];
	var pendingRequests = 0;
	var completedRequests = 0;
	
	console.log('Searching', galleryData.length, 'folders for:', searchTerm);
	
	galleryData.forEach(function(folder) {
		// Check if folder name/path matches
		var folderMatches = folder.name.toLowerCase().indexOf(searchTerm) !== -1 ||
		                    folder.vpath.toLowerCase().indexOf(searchTerm) !== -1;
		
		if (folderMatches) {
			console.log('Folder name/path match:', folder.name);
			// Apply year filter
			var matchesYear = !currentYear || currentYear === 'all';
			if (!matchesYear && folder.years && folder.years.length > 0) {
				matchesYear = folder.years.indexOf(parseInt(currentYear)) !== -1;
			}
			if (matchesYear) {
				matchingFolders.push(folder);
			}
		} else {
			// Check if any files in this folder match
			pendingRequests++;
			console.log('Checking files in folder:', folder.name, 'at', folder.vpath);
			checkFolderForFile(folder, searchTerm, function(hasMatch) {
				completedRequests++;
				console.log('Folder', folder.name, 'file check result:', hasMatch, '(', completedRequests, '/', pendingRequests, ')');
				if (hasMatch) {
					// Apply year filter
					var matchesYear = !currentYear || currentYear === 'all';
					if (!matchesYear && folder.years && folder.years.length > 0) {
						matchesYear = folder.years.indexOf(parseInt(currentYear)) !== -1;
					}
					if (matchesYear) {
						matchingFolders.push(folder);
					}
				}
				
				// When all requests complete, update display
				if (completedRequests === pendingRequests) {
					console.log('All folder checks complete. Matching folders:', matchingFolders.length);
					filteredData = matchingFolders;
					sortAndRender();
				}
			});
		}
	});
	
	// If no pending requests, update immediately
	if (pendingRequests === 0) {
		console.log('No pending requests. Showing', matchingFolders.length, 'matching folders immediately');
		filteredData = matchingFolders;
		sortAndRender();
	}
}

function checkFolderForFile(folder, searchTerm, callback) {
	// Check cache first
	var cacheKey = folder.vpath + ':' + searchTerm;
	if (searchCache[cacheKey] !== undefined) {
		callback(searchCache[cacheKey]);
		return;
	}
	
	// Queue the request if too many are active
	if (activeRequests >= maxConcurrentRequests) {
		requestQueue.push({ folder: folder, searchTerm: searchTerm, callback: callback });
		return;
	}
	
	activeRequests++;
	
	var xhr = new XMLHttpRequest();
	var path = folder.vpath;
	
	// Build proper URL - vpath already includes leading slash
	var url = SR + path + '?ls=j';
	
	xhr.open('GET', url, true);
	xhr.onload = function() {
		activeRequests--;
		
		// Process next queued request
		if (requestQueue.length > 0) {
			var next = requestQueue.shift();
			checkFolderForFile(next.folder, next.searchTerm, next.callback);
		}
		
		if (xhr.status === 200) {
			try {
				var data = JSON.parse(xhr.responseText);
				var files = data.files || [];
				
				console.log('Folder', folder.name, 'has', files.length, 'files');
				if (files.length > 0) {
					console.log('First file structure:', files[0]);
				}
				
				// Check if any file matches the search term
				var hasMatch = files.some(function(file) {
					var fname = file.href || file.name || file[0] || '';
					var matches = fname.toLowerCase().indexOf(searchTerm) !== -1;
					if (matches) {
						console.log('MATCH FOUND:', fname, 'in folder', folder.name);
					}
					return matches;
				});
				
				// Cache the result
				searchCache[cacheKey] = hasMatch;
				
				callback(hasMatch);
			} catch (e) {
				console.error('Error parsing folder data:', e);
				callback(false);
			}
		} else {
			console.warn('Failed to load folder:', path, 'Status:', xhr.status);
			callback(false);
		}
	};
	xhr.onerror = function() {
		activeRequests--;
		
		// Process next queued request
		if (requestQueue.length > 0) {
			var next = requestQueue.shift();
			checkFolderForFile(next.folder, next.searchTerm, next.callback);
		}
		
		console.error('XHR error loading folder:', path);
		callback(false);
	};
	xhr.send();
}

function filterGallery(searchTerm) {
	searchTerm = searchTerm.toLowerCase().trim();
	
	console.log('filterGallery called, currentYear:', currentYear);
	console.log('Total folders:', galleryData.length);
	
	// Reset to first page when filter changes
	currentPage = 0;
	
	filteredData = galleryData.filter(function(item) {
		// Apply search filter
		var matchesSearch = !searchTerm ||
			item.name.toLowerCase().indexOf(searchTerm) !== -1 ||
			item.vpath.toLowerCase().indexOf(searchTerm) !== -1;
		
		// Apply year filter - check if folder contains media from selected year
		var matchesYear = !currentYear || currentYear === 'all';
		if (!matchesYear && item.years && item.years.length > 0) {
			console.log('Checking folder:', item.name, 'years:', item.years, 'looking for:', currentYear);
			matchesYear = item.years.indexOf(parseInt(currentYear)) !== -1;
			console.log('Match result:', matchesYear);
		}
		
		return matchesSearch && matchesYear;
	});
	
	console.log('Filtered folders:', filteredData.length);
	
	sortAndRender();
}

function filterMedia(searchTerm) {
	searchTerm = searchTerm.toLowerCase().trim();
	
	// Store original media if not already stored
	if (!window.originalMedia) {
		window.originalMedia = currentMedia.slice();
	}
	
	if (!searchTerm) {
		// Restore all media if search is empty
		currentMedia = window.originalMedia.slice();
	} else {
		// Filter media by filename
		currentMedia = window.originalMedia.filter(function(media) {
			return media.name.toLowerCase().indexOf(searchTerm) !== -1;
		});
	}
	
	sortAndRender();
}

function sortAndRender() {
	if (currentFolder) {
		// Sort media files when in folder view
		sortMedia();
		renderMediaView();
		return;
	}
	
	// Sort the filtered folder data
	var parts = currentSort.split('-');
	var sortBy = parts[0];
	var sortDir = parts[1] || 'asc';
	
	filteredData.sort(function(a, b) {
		var result = 0;
		switch (sortBy) {
			case 'name':
				result = a.name.localeCompare(b.name);
				break;
			case 'date':
				result = (a.mtime || 0) - (b.mtime || 0);
				break;
			case 'size':
				result = (a.total_files || 0) - (b.total_files || 0);
				break;
		}
		return sortDir === 'desc' ? -result : result;
	});
	
	if (timelineMode) {
		renderTimelineView();
	} else {
		renderGallery();
	}
}

function sortMedia() {
	var parts = currentSort.split('-');
	var sortBy = parts[0];
	var sortDir = parts[1] || 'asc';
	
	currentMedia.sort(function(a, b) {
		var result = 0;
		switch (sortBy) {
			case 'name':
				result = a.name.localeCompare(b.name);
				break;
			case 'date':
				result = (a.mtime || 0) - (b.mtime || 0);
				break;
			case 'size':
				result = (a.size || 0) - (b.size || 0);
				break;
		}
		return sortDir === 'desc' ? -result : result;
	});
}

function renderGallery() {
	var grid = ebi('gallery-grid');
	var noResults = ebi('no-results');
	
	if (!grid) return;
	
	grid.innerHTML = '';
	
	if (filteredData.length === 0) {
		if (noResults) noResults.style.display = 'block';
		return;
	}
	
	if (noResults) noResults.style.display = 'none';
	
	// Calculate pagination
	var startIndex = currentPage * pageSize;
	var endIndex = Math.min(startIndex + pageSize, filteredData.length);
	var pageData = filteredData.slice(startIndex, endIndex);
	
	// Render current page
	pageData.forEach(function(item) {
		var card = createGalleryCard(item);
		grid.appendChild(card);
	});
	
	// Add pagination controls if needed
	if (filteredData.length > pageSize) {
		addPaginationControls(grid, filteredData.length);
	}
}

function addPaginationControls(container, totalItems) {
	var totalPages = Math.ceil(totalItems / pageSize);
	
	var paginationDiv = document.createElement('div');
	paginationDiv.className = 'pagination';
	paginationDiv.style.cssText = 'text-align:center;padding:20px;display:flex;gap:10px;justify-content:center;align-items:center;';
	
	// Previous button
	var prevBtn = document.createElement('button');
	prevBtn.textContent = '← Previous';
	prevBtn.disabled = currentPage === 0;
	prevBtn.style.cssText = 'padding:8px 16px;cursor:pointer;';
	prevBtn.onclick = function() {
		if (currentPage > 0) {
			currentPage--;
			renderGallery();
			window.scrollTo({ top: 0, behavior: 'smooth' });
		}
	};
	paginationDiv.appendChild(prevBtn);
	
	// Page info
	var pageInfo = document.createElement('span');
	pageInfo.textContent = 'Page ' + (currentPage + 1) + ' of ' + totalPages + ' (' + totalItems + ' folders)';
	pageInfo.style.cssText = 'padding:0 20px;';
	paginationDiv.appendChild(pageInfo);
	
	// Next button
	var nextBtn = document.createElement('button');
	nextBtn.textContent = 'Next →';
	nextBtn.disabled = currentPage >= totalPages - 1;
	nextBtn.style.cssText = 'padding:8px 16px;cursor:pointer;';
	nextBtn.onclick = function() {
		if (currentPage < totalPages - 1) {
			currentPage++;
			renderGallery();
			window.scrollTo({ top: 0, behavior: 'smooth' });
		}
	};
	paginationDiv.appendChild(nextBtn);
	
	container.appendChild(paginationDiv);
}

function renderMediaView() {
	var grid = ebi('gallery-grid');
	var noResults = ebi('no-results');
	var backBtn = ebi('back-btn');
	var backBottomBtn = ebi('backButtonBottom');
	var timelineBtn = ebi('timelineButton');
	var timelineView = ebi('timelineView');
	
	if (!grid) return;
	
	// Show back buttons and timeline button
	if (backBtn) backBtn.style.display = 'inline-block';
	if (backBottomBtn) backBottomBtn.style.display = 'inline-block';
	if (timelineBtn) timelineBtn.style.display = 'inline-block';
	
	// Show/hide views based on timeline mode
	if (timelineMode) {
		grid.style.display = 'none';
		if (timelineView) timelineView.style.display = 'block';
	} else {
		grid.style.display = 'grid';
		if (timelineView) timelineView.style.display = 'none';
	}
	
	// Keep search, sort, and year filter visible for filtering media
	var searchInput = ebi('search');
	var sortSelect = ebi('sort');
	var yearFilter = ebi('yearFilter');
	if (searchInput) searchInput.style.display = 'block';
	if (sortSelect) sortSelect.style.display = 'block';
	if (yearFilter) yearFilter.style.display = 'block';
	
	// Populate year filter with years from current media
	populateYearFilterForMedia();
	
	// If in timeline mode, render timeline view
	if (timelineMode) {
		renderMediaTimelineView();
		return;
	}
	
	// Otherwise render grid view
	// Apply filters to media
	var searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
	var filteredMedia = currentMedia.filter(function(media) {
		// Apply search filter
		var matchesSearch = !searchTerm || media.name.toLowerCase().indexOf(searchTerm) !== -1;
		
		// Apply year filter - only filter if year is selected and file has mtime
		var matchesYear = !currentYear || currentYear === 'all';
		if (!matchesYear && media.mtime && media.mtime > 0) {
			var itemYear = new Date(media.mtime * 1000).getFullYear().toString();
			matchesYear = itemYear === currentYear;
		} else if (!matchesYear && (!media.mtime || media.mtime === 0)) {
			// Files without mtime match "Unknown" year
			matchesYear = currentYear === 'unknown';
		}
		
		return matchesSearch && matchesYear;
	});
	
	grid.innerHTML = '';
	
	if (filteredMedia.length === 0) {
		if (noResults) {
			noResults.textContent = 'No media files found matching filters';
			noResults.style.display = 'block';
		}
		return;
	}
	
	if (noResults) noResults.style.display = 'none';
	
	filteredMedia.forEach(function(media, index) {
		var card = createMediaCard(media, index);
		grid.appendChild(card);
	});
}

function createGalleryCard(item) {
	var card = document.createElement('div');
	card.className = 'gallery-item';
	
	// Create thumbnail
	var thumb = document.createElement('div');
	if (item.thumb_url) {
		var img = document.createElement('img');
		img.className = 'gallery-thumb';
		img.src = item.thumb_url;
		img.alt = item.name;
		img.onerror = function() {
			this.parentNode.innerHTML = '<div class="gallery-thumb placeholder">📁</div>';
		};
		thumb.appendChild(img);
	} else {
		thumb.innerHTML = '<div class="gallery-thumb placeholder">📁</div>';
	}
	card.appendChild(thumb);
	
	// Create info section
	var info = document.createElement('div');
	info.className = 'gallery-info';
	
	var title = document.createElement('div');
	title.className = 'gallery-title';
	title.textContent = item.name;
	title.title = item.name;
	info.appendChild(title);
	
	var path = document.createElement('div');
	path.className = 'gallery-path';
	path.textContent = item.vpath;
	path.title = item.vpath;
	info.appendChild(path);
	
	var meta = document.createElement('div');
	meta.className = 'gallery-meta';
	
	var counts = document.createElement('div');
	counts.className = 'gallery-count';
	
	if (item.image_count > 0) {
		var imgCount = document.createElement('span');
		imgCount.innerHTML = '🖼️ ' + item.image_count;
		imgCount.title = item.image_count + ' images';
		counts.appendChild(imgCount);
	}
	
	if (item.video_count > 0) {
		var vidCount = document.createElement('span');
		vidCount.innerHTML = '🎬 ' + item.video_count;
		vidCount.title = item.video_count + ' videos';
		counts.appendChild(vidCount);
	}
	
	if (item.audio_count > 0) {
		var audCount = document.createElement('span');
		audCount.innerHTML = '🎵 ' + item.audio_count;
		audCount.title = item.audio_count + ' audio files';
		counts.appendChild(audCount);
	}
	
	meta.appendChild(counts);
	info.appendChild(meta);
	
	card.appendChild(info);
	
	// Make card clickable to load folder contents
	card.addEventListener('click', function() {
		loadFolderMedia(item.vpath);
	});
	
	return card;
}

function createMediaCard(media, index) {
	var card = document.createElement('div');
	card.className = 'gallery-item media-item';
	
	// Create thumbnail/preview
	var thumb = document.createElement('div');
	if (media.type === 'image' || media.type === 'video') {
		var img = document.createElement('img');
		img.className = 'gallery-thumb';
		// Use thumbnail for both images and videos
		img.src = media.thumb || media.url;
		img.alt = media.name;
		img.loading = 'lazy';
		thumb.appendChild(img);
	} else {
		// Audio files get placeholder
		thumb.innerHTML = '<div class="gallery-thumb placeholder">🎵</div>';
	}
	card.appendChild(thumb);
	
	// Create info section
	var info = document.createElement('div');
	info.className = 'gallery-info';
	
	var title = document.createElement('div');
	title.className = 'gallery-title';
	title.textContent = media.name;
	title.title = media.name;
	info.appendChild(title);
	
	var meta = document.createElement('div');
	meta.className = 'gallery-meta';
	
	var type = document.createElement('span');
	type.textContent = media.type;
	meta.appendChild(type);
	
	info.appendChild(meta);
	card.appendChild(info);
	
	// Make card clickable to open media
	card.addEventListener('click', function() {
		window.open(media.url, '_blank');
	});
	
	return card;
}

function showLoading(show) {
	var loading = ebi('loading');
	if (loading) {
		loading.style.display = show ? 'block' : 'none';
	}
}

function showError(message) {
	var grid = ebi('gallery-grid');
	if (grid) {
		grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--fg-dim);">' + 
		                 esc(message) + '</div>';
	}
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init);
} else {
	init();
}

J_GAL = 2;

// Made with Bob
