/* global GPXTrack */
/* global GPXPeakTrack */
let userId = null;
let gpxDocText = null;

document.addEventListener("DOMContentLoaded", () => {
  checkLoginStatus();
  document.getElementById("login-button").addEventListener("click", () => {
    chrome.tabs.create({
      url: "https://peakbagger.com/Climber/Login.aspx",
    });
  });

  // File selection handler
  document
    .getElementById("select-file-button")
    .addEventListener("click", handleFileSelection);

  // Mode selection handlers
  document.getElementById("auto-detect").addEventListener("click", () => {
    document.getElementById("peak-selection").classList.add("hidden");
    document.getElementById("manual-search").classList.add("hidden");
    autoDetectPeaks();
  });

  document.getElementById("manual-select").addEventListener("click", () => {
    document.getElementById("peak-selection").classList.add("hidden");
  });

  document
    .getElementById("draft-ascents")
    .addEventListener("click", openAscentTabs);

  document.getElementById("manual-select").addEventListener("click", () => {
    document.getElementById("peak-selection").classList.add("hidden");
    document.getElementById("manual-search").classList.remove("hidden");
    setupManualSearch();
  });
});

function handleFileSelection() {
  const fileInput = document.getElementById("gpx-file-input");
  fileInput.onchange = async (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        gpxDocText = e.target.result;
        const selectedFile = document.getElementById("selected-file");
        selectedFile.textContent = file.name;
        selectedFile.classList.remove("hidden");
        document.getElementById("mode-selection").classList.remove("hidden");
      };
      reader.readAsText(file);
    }
  };
  fileInput.click();
}

function displayPeakList(sortedPeaks) {
  const peakContainers = document.getElementById("peak-containers");
  peakContainers.innerHTML = ""; // Clear existing content

  const peakList = document.createElement("ul");
  peakList.className = "peak-list";

  sortedPeaks.forEach((peak) => {
    const listItem = document.createElement("li");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    console.log("checkbox peak", peak);
    checkbox.dataset.id = peak.peakId;
    checkbox.dataset.lat = peak.gpxPeakTrack.peakCoordinates.lat;
    checkbox.dataset.lon = peak.gpxPeakTrack.peakCoordinates.lon;
    checkbox.checked = true; // Default to checked

    const label = document.createElement("label");
    label.htmlFor = peak.peakId;
    label.textContent = peak.name;

    listItem.appendChild(checkbox);
    listItem.appendChild(label);
    peakList.appendChild(listItem);
  });

  peakContainers.appendChild(peakList);
  document.getElementById("loading-peaks").classList.add("hidden");
  document.getElementById("peak-selection").classList.remove("hidden");
}

async function autoDetectPeaks() {
  try {
    console.log("Autodetecting peaks");
    if (!gpxDocText) return;

    document.getElementById("loading-peaks").classList.remove("hidden");
    const parser = new DOMParser();
    const gpxDocXml = parser.parseFromString(gpxDocText, "text/xml");
    const gpxTrack = GPXTrack.fromGpxDocXml(gpxDocXml);
    const peaks = await getNearbyPeaksFromGpxDocXml(gpxDocXml);
    const sortedPeaks = await getPeaksOnTrack(peaks, gpxTrack);
    for (const peak of sortedPeaks) {
      console.log(
        `Peak: ${peak.name}, Distance: ${peak.gpxPeakTrack.closestDistanceFtToPeak}`
      );
    }

    displayPeakList(sortedPeaks);
  } catch (error) {
    console.error("Error autodetecting peaks:", error);
    alert("Error autodetecting peaks. Please try again.");
  }
}

async function getNearbyPeaksFromGpxDocXml(gpxDocXml) {
  const gpxTrack = GPXTrack.fromGpxDocXml(gpxDocXml);
  const midPoint = gpxTrack.roughMidPoint;
  try {
    const response = await chrome.runtime.sendMessage({
      action: "getNearbyPeaks",
      lat: midPoint.lat,
      lon: midPoint.lon,
      userId: userId,
    });

    if (response.error) {
      console.error("Error fetching nearby peaks:", response.error);
      alert("Failed to fetch nearby peaks from Peakbagger!");
      return [];
    }
    const nearbyPeaks = await parseNearbyPeaksResponse(response.peaksText);
    return nearbyPeaks;
  } catch (error) {
    console.error("Error fetching nearby peaks:", error);
    throw new Error("Failed to fetch nearby peaks");
  }
}

async function getPeaksOnTrack(peaks, gpxTrack) {
  const startTime = performance.now();
  const peakMap = new Map();
  for (const peak of peaks) {
    const peakCoordinates = { lat: peak.lat, lon: peak.lon };
    console.log("Track Points:", gpxTrack.trackPoints.length);
    const gpxPeakTrack = new GPXPeakTrack(
      gpxTrack.trackPoints,
      peakCoordinates
    );
    if (gpxPeakTrack.closestDistanceFtToPeak < 500) {
      peakMap.set(peak, gpxPeakTrack);
    }
  }
  // Create sorted array of peaks by closest distance
  const sortedPeaks = Array.from(peakMap.entries())
    .sort((a, b) => a[1].closestDistanceFtToPeak - b[1].closestDistanceFtToPeak)
    .map(([peak, gpxPeakTrack]) => ({
      name: `${peak.name}, ${peak.location} (${peak.elevationFt}')`,
      peakId: peak.id,
      gpxPeakTrack: gpxPeakTrack,
    }));

  const endTime = performance.now();
  console.log(
    `getPeaksToTracks took ${((endTime - startTime) / 1000).toFixed(2)} seconds`
  );
  return sortedPeaks;
}

async function parseNearbyPeaksResponse(text) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(text, "text/xml");
  const pbElement = xmlDoc.getElementsByTagName("pb")[0];
  if (!pbElement) {
    alert("Unexpected results from peak search. Try again later.");
    return [];
  }

  // Convert XML to array of peak objects
  // Example row:
  // 	<r i="21582" n="Lone Mountain" f="3342" a="36.238156" o="-115.315186" t="410" r="542" s="2.24" l="USA-NV" lkvp="1*48349|2*154811|6*W7N/CK-227|9*841766"/>
  const peaks = Array.from(xmlDoc.getElementsByTagName("r")).map((peak) => ({
    id: parseInt(peak.getAttribute("i")),
    name: peak.getAttribute("n"),
    elevationFt: parseInt(peak.getAttribute("f")),
    lat: parseFloat(peak.getAttribute("a")),
    lon: parseFloat(peak.getAttribute("o")),
    //unknown: parseInt(peak.getAttribute("t")),
    prominence: parseInt(peak.getAttribute("r")),
    // unknown: parseFloat(peak.getAttribute("s")),
    location: peak.getAttribute("l"),
  }));
  return peaks;
}

function updateLoginSections(isLoggedIn) {
  document.getElementById("loading-section").classList.add("hidden");
  document
    .getElementById("login-section")
    .classList.toggle("hidden", isLoggedIn);
  document
    .getElementById("main-content")
    .classList.toggle("hidden", !isLoggedIn);
}

async function checkLoginStatus() {
  try {
    const response = await fetch("https://peakbagger.com/Default.aspx");
    const text = await response.text();
    const match = text.match(
      /href="climber\/climber\.aspx\?cid=(\d+)">My Home Page<\/a>/
    );

    if (match && match[1]) {
      userId = match[1];
      updateLoginSections(true);
    } else {
      updateLoginSections(false);
    }
  } catch (error) {
    console.error("Error checking login status:", error);
    updateLoginSections(false);
  }
}

async function openAscentTabs() {
  const checkboxes = document.querySelectorAll(
    ".peak-list input[type=\"checkbox\"]:checked"
  );
  if (!gpxDocText) return;

  let peaks = [];
  checkboxes.forEach((checkbox) => {
    const peak = {
      peakId: checkbox.dataset.id,
      peakCoordinates: { lat: checkbox.dataset.lat, lon: checkbox.dataset.lon },
    };
    console.log("Adding peak to array:", peak);
    peaks.push(peak);
  });

  await chrome.runtime.sendMessage({
    action: "draftMultiplePBAscents",
    gpxContent: gpxDocText,
    peaks: peaks,
    userId: userId,
  });
}

function setupManualSearch() {
  document
    .getElementById("search-peaks-button")
    .addEventListener("click", searchPeaks);
  document
    .getElementById("draft-manual-ascent")
    .addEventListener("click", draftManualAscent);
}

async function searchPeaks() {
  const searchText = document.getElementById("peak-search").value;
  if (!searchText) return;

  try {
    const response = await chrome.runtime.sendMessage({
      action: "searchPeaks",
      searchText: searchText,
      userId: userId,
    });

    if (response.error) {
      console.error("Error searching peaks:", response.error);
      return;
    }

    const peaks = parseSearchResults(response.peaksText);
    displaySearchResults(peaks);
  } catch (error) {
    console.error("Error during peak search:", error);
  }
}

function parseSearchResults(text) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(text, "text/xml");
  // Check for <pb> element
  const pbElement = xmlDoc.getElementsByTagName("pb")[0];
  if (!pbElement) {
    alert("Unexpected results from peak search. Try again later.");
    return [];
  }
  return Array.from(xmlDoc.getElementsByTagName("r")).map((peak) => ({
    id: peak.getAttribute("i"),
    name: peak.getAttribute("n"),
    elevation: peak.getAttribute("f"),
    location: peak.getAttribute("l"),
    lat: peak.getAttribute("a"),
    lon: peak.getAttribute("o"),
  }));
}

function displaySearchResults(peaks) {
  const select = document.getElementById("peak-results");
  select.innerHTML = "";

  peaks.forEach((peak) => {
    const option = document.createElement("option");
    option.value = JSON.stringify(peak);
    option.textContent = `${peak.name}, ${peak.location} (${peak.elevation}')`;
    select.appendChild(option);
  });
}

async function draftManualAscent() {
  const select = document.getElementById("peak-results");
  const selectedOption = select.options[select.selectedIndex];
  if (!selectedOption || !gpxDocText) return;

  const peak = JSON.parse(selectedOption.value);

  await chrome.runtime.sendMessage({
    action: "draftPBAscent",
    gpxContent: gpxDocText,
    peakId: peak.id,
    peakCoordinates: { lat: peak.lat, lon: peak.lon },
    userId: userId,
  });
}
