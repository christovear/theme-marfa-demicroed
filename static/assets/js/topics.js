(function () {
	"use strict";

	var root = document.querySelector(".topics-page");
	var dataElement = document.getElementById("topics-data");
	var svg = root ? root.querySelector(".topics-graph") : null;
	if (!root || !dataElement || !svg) return;

	var svgNamespace = "http://www.w3.org/2000/svg";
	var linkNamespace = "http://www.w3.org/1999/xlink";
	var graphTitleId = "topics-graph-title";
	var graphDescriptionId = "topics-graph-description";
	var data;

	try {
		data = JSON.parse(dataElement.textContent);
	} catch (error) {
		root.setAttribute("data-topics-error", error.name || "Error");
		root.querySelector(".topics-status").textContent = "The topic data could not be read.";
		return;
	}

	var topics = Array.isArray(data.topics) ? data.topics.slice() : [];
	var postTopicSets = Array.isArray(data.postTopicSets) ? data.postTopicSets : [];
	var status = root.querySelector(".topics-status");
	var graphFrame = root.querySelector(".topics-graph-frame");
	var emptyState = root.querySelector(".topics-graph-empty");
	var topicById = {};
	var pairWeights = {};
	var connections = [];
	var adjacency = {};
	var nodeElements = {};
	var edgeElements = [];
	var hoverTopicId = null;
	var touchTopicId = null;
	var lastPointerType = "";
	var resizeTimer = null;

	function normalize(value) {
		return String(value || "").toLowerCase().trim();
	}

	function makeSvgElement(name, attributes) {
		var element = document.createElementNS(svgNamespace, name);
		Object.keys(attributes || {}).forEach(function (key) {
			element.setAttribute(key, attributes[key]);
		});
		return element;
	}

	function hashString(value) {
		var hash = 2166136261;
		for (var index = 0; index < value.length; index += 1) {
			hash ^= value.charCodeAt(index);
			hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
		}
		return hash >>> 0;
	}

	function pairKey(first, second) {
		return first < second ? first + "\u0000" + second : second + "\u0000" + first;
	}

	function buildConnections() {
		postTopicSets.forEach(function (topicSet) {
			var uniqueTopics = [];
			var seen = {};
			var topicIds = topicSet && Array.isArray(topicSet.topics) ? topicSet.topics : topicSet;

			if (!Array.isArray(topicIds)) return;
			topicIds.forEach(function (topicId) {
				topicId = normalize(topicId);
				if (!topicById[topicId] || seen[topicId]) return;
				seen[topicId] = true;
				uniqueTopics.push(topicId);
			});

			for (var firstIndex = 0; firstIndex < uniqueTopics.length; firstIndex += 1) {
				for (var secondIndex = firstIndex + 1; secondIndex < uniqueTopics.length; secondIndex += 1) {
					var key = pairKey(uniqueTopics[firstIndex], uniqueTopics[secondIndex]);
					pairWeights[key] = (pairWeights[key] || 0) + 1;
				}
			}
		});

		Object.keys(pairWeights).forEach(function (key) {
			var ids = key.split("\u0000");
			var connection = { source: ids[0], target: ids[1], weight: pairWeights[key] };
			connections.push(connection);
			adjacency[ids[0]].push(connection);
			adjacency[ids[1]].push(connection);
		});

		connections.sort(function (first, second) {
			return second.weight - first.weight;
		});
	}

	function topicScale(count, minimum, maximum, maxCount) {
		if (maxCount <= 1) return minimum;
		var ratio = Math.log(count + 1) / Math.log(maxCount + 1);
		return minimum + ((maximum - minimum) * ratio);
	}

	function createLayout(width, height) {
		var maxCount = topics.reduce(function (largest, topic) {
			return Math.max(largest, topic.count);
		}, 1);
		var profile = width < 500
			? { ringCounts: [1, 4, 4], radii: [0, .38, .72], fontMaximum: 19, padding: 34 }
			: (width < 760
				? { ringCounts: [1, 5, 8], radii: [0, .38, .74], fontMaximum: 22, padding: 46 }
				: { ringCounts: [1, 6, 12], radii: [0, .4, .76], fontMaximum: 26, padding: 58 });
		var labelLimit = Math.min(topics.length, profile.ringCounts.reduce(function (total, count) {
			return total + count;
		}, 0));
		var centerX = width / 2;
		var centerY = height / 2;
		var radiusX = Math.max(20, (width / 2) - profile.padding);
		var radiusY = Math.max(20, (height / 2) - profile.padding);
		var nodes = [];
		var orbits = [];

		function addNode(topic, index, labeled, x, y) {
			nodes.push({
				id: topic.id,
				label: topic.label,
				url: topic.url,
				count: topic.count,
				index: index,
				labeled: labeled,
				fontSize: topicScale(topic.count, 12, profile.fontMaximum, maxCount),
				dotRadius: topicScale(topic.count, 2.5, 7.5, maxCount),
				x: x,
				y: y,
				labelOffsetY: 0
			});
		}

		var topicIndex = 0;
		profile.ringCounts.forEach(function (ringCount, ringIndex) {
			var available = Math.min(ringCount, labelLimit - topicIndex);
			if (available <= 0) return;
			var scale = profile.radii[ringIndex];
			if (scale === 0) {
				addNode(topics[topicIndex], topicIndex, true, centerX, centerY);
				topicIndex += 1;
				return;
			}

			var ringRadiusX = radiusX * scale;
			var ringRadiusY = radiusY * scale;
			var angleOffset = (-Math.PI / 2) + (ringIndex === 2 ? Math.PI / Math.max(4, available) : 0);
			orbits.push({ radiusX: ringRadiusX, radiusY: ringRadiusY, kind: "topic" });
			for (var position = 0; position < available; position += 1) {
				var angle = angleOffset + ((Math.PI * 2 * position) / available);
				addNode(
					topics[topicIndex],
					topicIndex,
					true,
					centerX + (Math.cos(angle) * ringRadiusX),
					centerY + (Math.sin(angle) * ringRadiusY)
				);
				topicIndex += 1;
			}
		});

		var haloTopics = topics.slice(labelLimit).sort(function (first, second) {
			return hashString(first.id) - hashString(second.id);
		});
		var haloRadii = [.84, 1];
		haloRadii.forEach(function (scale) {
			orbits.push({ radiusX: radiusX * scale, radiusY: radiusY * scale, kind: "halo" });
		});
		haloTopics.forEach(function (topic, index) {
			var haloRing = index % haloRadii.length;
			var position = Math.floor(index / haloRadii.length);
			var countOnRing = Math.ceil((haloTopics.length - haloRing) / haloRadii.length);
			var angleOffset = (-Math.PI / 2) + (haloRing ? Math.PI / Math.max(1, countOnRing) : 0);
			var angle = angleOffset + ((Math.PI * 2 * position) / Math.max(1, countOnRing));
			addNode(
				topic,
				labelLimit + index,
				false,
				centerX + (Math.cos(angle) * radiusX * haloRadii[haloRing]),
				centerY + (Math.sin(angle) * radiusY * haloRadii[haloRing])
			);
		});

		var layoutById = {};
		nodes.forEach(function (node) { layoutById[node.id] = node; });
		nodes.forEach(function (node) {
			node.labelAnchor = node.labeled && Math.abs(node.x - centerX) < 45 ? "middle" : (node.x > centerX ? "end" : "start");
			if (node.x < 165) node.labelAnchor = "start";
			if (node.x > width - 165) node.labelAnchor = "end";
		});
		var labeledNodes = nodes.filter(function (node) { return node.labeled; });

		function labelBounds(node) {
			var labelWidth = node.label.length * node.fontSize * .55;
			var edge = node.labelAnchor === "end"
				? node.x - node.dotRadius - 7
				: (node.labelAnchor === "middle" ? node.x : node.x + node.dotRadius + 7);
			var centerY = node.y + node.labelOffsetY;
			return {
				left: node.labelAnchor === "end" ? edge - labelWidth : (node.labelAnchor === "middle" ? edge - (labelWidth / 2) : edge),
				right: node.labelAnchor === "end" ? edge : (node.labelAnchor === "middle" ? edge + (labelWidth / 2) : edge + labelWidth),
				top: centerY - (node.fontSize * .65),
				bottom: centerY + (node.fontSize * .65)
			};
		}

		for (var settle = 0; settle < 96; settle += 1) {
			for (var firstIndex = 0; firstIndex < labeledNodes.length; firstIndex += 1) {
				for (var secondIndex = firstIndex + 1; secondIndex < labeledNodes.length; secondIndex += 1) {
					var firstNode = labeledNodes[firstIndex];
					var secondNode = labeledNodes[secondIndex];
					var firstBounds = labelBounds(firstNode);
					var secondBounds = labelBounds(secondNode);
					var horizontallyOverlapping = firstBounds.left < secondBounds.right + 5 && firstBounds.right + 5 > secondBounds.left;
					var verticallyOverlapping = firstBounds.top < secondBounds.bottom + 4 && firstBounds.bottom + 4 > secondBounds.top;
					if (!horizontallyOverlapping || !verticallyOverlapping) continue;

					var overlap = Math.min(firstBounds.bottom, secondBounds.bottom) - Math.max(firstBounds.top, secondBounds.top) + 4;
					var direction = (firstNode.y + firstNode.labelOffsetY) <= (secondNode.y + secondNode.labelOffsetY) ? 1 : -1;
					firstNode.labelOffsetY -= (overlap / 2) * direction;
					secondNode.labelOffsetY += (overlap / 2) * direction;
					firstNode.labelOffsetY = Math.max(20 - firstNode.y, Math.min(height - 20 - firstNode.y, firstNode.labelOffsetY));
					secondNode.labelOffsetY = Math.max(20 - secondNode.y, Math.min(height - 20 - secondNode.y, secondNode.labelOffsetY));
				}
			}
		}

		return { nodes: nodes, byId: layoutById, orbits: orbits };
	}

	function setStatus(topic, touchSelection) {
		if (!topic) {
			status.textContent = topics.length + " topics · choose one to open its archive";
			return;
		}

		var related = adjacency[topic.id].slice().sort(function (first, second) {
			return second.weight - first.weight;
		}).slice(0, 3).map(function (connection) {
			var relatedId = connection.source === topic.id ? connection.target : connection.source;
			return topicById[relatedId].label;
		});
		var relationText = related.length ? " · often appears with " + related.join(", ") : " · no repeated connections yet";
		var touchText = touchSelection ? " · tap again to open" : "";
		status.innerHTML = "<strong>" + escapeHtml(topic.label) + "</strong> · " + topic.count + (topic.count === 1 ? " post" : " posts") + relationText + touchText;
	}

	function escapeHtml(value) {
		var temporary = document.createElement("span");
		temporary.textContent = value;
		return temporary.innerHTML;
	}

	function activateTopic(topicId, touchSelection) {
		var topic = topicById[topicId];
		if (!topic) return;
		hoverTopicId = topicId;
		var relatedIds = {};
		relatedIds[topicId] = true;
		adjacency[topicId].forEach(function (connection) {
			relatedIds[connection.source === topicId ? connection.target : connection.source] = true;
		});

		svg.classList.add("has-active");
		Object.keys(nodeElements).forEach(function (id) {
			nodeElements[id].forEach(function (element) {
				element.classList.toggle("is-active", id === topicId);
				element.classList.toggle("is-related", id !== topicId && Boolean(relatedIds[id]));
				element.classList.toggle("is-dim", !relatedIds[id]);
			});
		});
		edgeElements.forEach(function (entry) {
			entry.element.classList.toggle("is-active", entry.connection.source === topicId || entry.connection.target === topicId);
		});
		setStatus(topic, touchSelection);
	}

	function clearActiveTopic() {
		hoverTopicId = null;
		svg.classList.remove("has-active");
		Object.keys(nodeElements).forEach(function (id) {
			nodeElements[id].forEach(function (element) {
				element.classList.remove("is-active", "is-related", "is-dim");
			});
		});
		edgeElements.forEach(function (entry) {
			entry.element.classList.remove("is-active");
		});
		setStatus(null);
	}

	function renderGraph() {
		var width = Math.max(280, Math.round(graphFrame.getBoundingClientRect().width));
		var height = width < 430 ? 500 : (width < 700 ? 540 : 610);
		svg.textContent = "";
		nodeElements = {};
		edgeElements = [];
		svg.setAttribute("viewBox", "0 0 " + width + " " + height);
		svg.setAttribute("height", height);

		var title = makeSvgElement("title", { id: graphTitleId });
		title.textContent = "Interactive topic orbit";
		var description = makeSvgElement("desc", { id: graphDescriptionId });
		description.textContent = "Frequently used topics occupy the inner rings. Smaller topics form the outer halo. Lines connect topics that appear together in posts.";
		svg.appendChild(title);
		svg.appendChild(description);

		if (!topics.length) {
			emptyState.hidden = false;
			status.textContent = "No topics are available yet.";
			return;
		}
		emptyState.hidden = true;

		var layout = createLayout(width, height);
		var orbitLayer = makeSvgElement("g", { "aria-hidden": "true" });
		var edgeLayer = makeSvgElement("g", { "aria-hidden": "true" });
		var dotLayer = makeSvgElement("g", { "aria-hidden": "true" });
		var labelLayer = makeSvgElement("g", {});

		layout.orbits.forEach(function (orbit) {
			orbitLayer.appendChild(makeSvgElement("ellipse", {
				cx: (width / 2).toFixed(2),
				cy: (height / 2).toFixed(2),
				rx: orbit.radiusX.toFixed(2),
				ry: orbit.radiusY.toFixed(2),
				"class": "topic-orbit is-" + orbit.kind
			}));
		});

		connections.forEach(function (connection) {
			var source = layout.byId[connection.source];
			var target = layout.byId[connection.target];
			if (!source || !target) return;
			var line = makeSvgElement("line", {
				x1: source.x.toFixed(2),
				y1: source.y.toFixed(2),
				x2: target.x.toFixed(2),
				y2: target.y.toFixed(2),
				"stroke-width": Math.min(3, .65 + (connection.weight * .22)).toFixed(2),
				"class": "topic-edge" + (connection.weight >= 4 ? " is-strong" : "")
			});
			edgeLayer.appendChild(line);
			edgeElements.push({ element: line, connection: connection });
		});

		layout.nodes.forEach(function (node) {
			var visual = makeSvgElement("g", {
				"class": "topic-node-visual" + (node.labeled ? "" : " is-secondary"),
				transform: "translate(" + node.x.toFixed(2) + " " + node.y.toFixed(2) + ")"
			});
			var dot = makeSvgElement("circle", { "class": "topic-node-dot", r: node.dotRadius.toFixed(2) });
			visual.appendChild(dot);
			dotLayer.appendChild(visual);

			var link = makeSvgElement("a", {
				href: node.url,
				"class": "topic-node" + (node.labeled ? "" : " is-secondary"),
				"data-topic-id": node.id,
				"aria-label": node.label + ", " + node.count + (node.count === 1 ? " post" : " posts")
			});
			link.setAttributeNS(linkNamespace, "xlink:href", node.url);
			if (!node.labeled) link.setAttribute("tabindex", "-1");

			var group = makeSvgElement("g", { transform: "translate(" + node.x.toFixed(2) + " " + node.y.toFixed(2) + ")" });
			var hit = makeSvgElement("circle", { "class": "topic-node-hit", r: 22 });
			var labelAnchor = node.labelAnchor || "start";
			var label = makeSvgElement("text", {
				x: (labelAnchor === "end" ? -node.dotRadius - 7 : (labelAnchor === "middle" ? 0 : node.dotRadius + 7)).toFixed(2),
				y: (node.labelOffsetY + (node.fontSize * .35)).toFixed(2),
				"font-size": node.fontSize.toFixed(2),
				"text-anchor": labelAnchor
			});
			label.textContent = node.label;
			group.appendChild(hit);
			group.appendChild(label);
			link.appendChild(group);
			labelLayer.appendChild(link);
			nodeElements[node.id] = [visual, link];

			link.addEventListener("pointerenter", function (event) {
				if (event.pointerType === "touch") return;
				touchTopicId = null;
				activateTopic(node.id, false);
			});
			link.addEventListener("pointerleave", function (event) {
				if (event.pointerType !== "touch") clearActiveTopic();
			});
			link.addEventListener("pointerdown", function (event) {
				lastPointerType = event.pointerType || "";
			});
			link.addEventListener("click", function (event) {
				var touchInput = lastPointerType === "touch" || (window.matchMedia && window.matchMedia("(hover: none)").matches);
				if (!touchInput) return;
				if (touchTopicId !== node.id) {
					event.preventDefault();
					touchTopicId = node.id;
					activateTopic(node.id, true);
				}
			});
			link.addEventListener("focus", function () {
				if (touchTopicId !== node.id) activateTopic(node.id, false);
			});
			link.addEventListener("blur", function () {
				if (!touchTopicId) clearActiveTopic();
			});
		});

		svg.appendChild(orbitLayer);
		svg.appendChild(edgeLayer);
		svg.appendChild(dotLayer);
		svg.appendChild(labelLayer);
		if (hoverTopicId) activateTopic(hoverTopicId);
		else setStatus(null);
	}

	function clearTouchTopic(event) {
		if (event.pointerType !== "touch") return;
		var targetNode = event.target.closest ? event.target.closest(".topic-node") : null;
		if (targetNode) return;
		touchTopicId = null;
		clearActiveTopic();
	}

	topics.sort(function (first, second) {
		if (second.count !== first.count) return second.count - first.count;
		return first.label.localeCompare(second.label);
	});
	topics.forEach(function (topic) {
		topic.id = normalize(topic.id);
		topic.count = Number(topic.count) || 0;
		topicById[topic.id] = topic;
		adjacency[topic.id] = [];
	});
	buildConnections();

	svg.addEventListener("pointerdown", clearTouchTopic);
	svg.addEventListener("pointerleave", function (event) {
		if (event.pointerType !== "touch" && !touchTopicId) clearActiveTopic();
	});
	renderGraph();
	if (window.ResizeObserver) {
		new ResizeObserver(function () {
			window.clearTimeout(resizeTimer);
			resizeTimer = window.setTimeout(renderGraph, 120);
		}).observe(graphFrame);
	} else {
		window.addEventListener("resize", function () {
			window.clearTimeout(resizeTimer);
			resizeTimer = window.setTimeout(renderGraph, 120);
		});
	}
}());
