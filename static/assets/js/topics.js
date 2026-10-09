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
		var labelLimit = width < 500 ? 14 : (width < 760 ? 20 : 30);
		var padding = width < 500 ? 34 : 52;
		var centerX = width / 2;
		var centerY = height / 2;
		var nodes = topics.map(function (topic, index) {
			var seed = hashString(topic.id);
			var angle = ((seed % 3600) / 3600) * Math.PI * 2;
			var orbit = 0.18 + ((((seed >>> 7) % 1000) / 1000) * 0.76);
			var radiusX = Math.max(20, (width / 2) - padding);
			var radiusY = Math.max(20, (height / 2) - padding);
			var fontSize = topicScale(topic.count, 12, width < 500 ? 21 : 29, maxCount);
			return {
				id: topic.id,
				label: topic.label,
				url: topic.url,
				count: topic.count,
				index: index,
				labeled: index < labelLimit,
				fontSize: fontSize,
				dotRadius: topicScale(topic.count, 2.5, 7.5, maxCount),
				x: centerX + (Math.cos(angle) * radiusX * orbit),
				y: centerY + (Math.sin(angle) * radiusY * orbit),
				vx: 0,
				vy: 0
			};
		});
		var layoutById = {};
		nodes.forEach(function (node) { layoutById[node.id] = node; });
		var layoutEdges = connections.filter(function (connection) {
			return connection.weight >= 2 && layoutById[connection.source] && layoutById[connection.target];
		});

		for (var iteration = 0; iteration < 150; iteration += 1) {
			var cooling = 1 - (iteration / 150);
			for (var first = 0; first < nodes.length; first += 1) {
				for (var second = first + 1; second < nodes.length; second += 1) {
					var firstNode = nodes[first];
					var secondNode = nodes[second];
					var dx = secondNode.x - firstNode.x;
					var dy = secondNode.y - firstNode.y;
					var distanceSquared = Math.max(36, (dx * dx) + (dy * dy));
					var distance = Math.sqrt(distanceSquared);
					var repulsion = (width < 500 ? 1800 : 2400) / distanceSquared;
					var pushX = (dx / distance) * repulsion * cooling;
					var pushY = (dy / distance) * repulsion * cooling;
					firstNode.vx -= pushX;
					firstNode.vy -= pushY;
					secondNode.vx += pushX;
					secondNode.vy += pushY;
				}
			}

			layoutEdges.forEach(function (connection) {
				var source = layoutById[connection.source];
				var target = layoutById[connection.target];
				var dx = target.x - source.x;
				var dy = target.y - source.y;
				var distance = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));
				var desired = Math.max(118, 190 - (Math.min(connection.weight, 8) * 8));
				var pull = (distance - desired) * .00075 * cooling;
				var pullX = (dx / distance) * pull;
				var pullY = (dy / distance) * pull;
				source.vx += pullX;
				source.vy += pullY;
				target.vx -= pullX;
				target.vy -= pullY;
			});

			nodes.forEach(function (node) {
				node.vx += (centerX - node.x) * .0006 * cooling;
				node.vy += (centerY - node.y) * .0006 * cooling;
				node.vx *= .82;
				node.vy *= .82;
				node.x = Math.max(padding, Math.min(width - padding, node.x + node.vx));
				node.y = Math.max(padding, Math.min(height - padding, node.y + node.vy));
			});
		}

		for (var settle = 0; settle < 18; settle += 1) {
			for (var labelFirst = 0; labelFirst < labelLimit; labelFirst += 1) {
				for (var labelSecond = labelFirst + 1; labelSecond < labelLimit; labelSecond += 1) {
					var firstLabel = nodes[labelFirst];
					var secondLabel = nodes[labelSecond];
					var labelDx = secondLabel.x - firstLabel.x;
					var labelDy = secondLabel.y - firstLabel.y;
					var firstWidth = Math.min(170, firstLabel.label.length * firstLabel.fontSize * .55);
					var secondWidth = Math.min(170, secondLabel.label.length * secondLabel.fontSize * .55);
					var requiredX = ((firstWidth + secondWidth) / 2) + 12;
					var requiredY = ((firstLabel.fontSize + secondLabel.fontSize) / 2) + 9;
					if (Math.abs(labelDx) < requiredX && Math.abs(labelDy) < requiredY) {
						var direction = labelDy >= 0 ? 1 : -1;
						var shift = ((requiredY - Math.abs(labelDy)) / 2) + 1;
						firstLabel.y = Math.max(padding, firstLabel.y - (shift * direction));
						secondLabel.y = Math.min(height - padding, secondLabel.y + (shift * direction));
					}
				}
			}
		}

		return { nodes: nodes, byId: layoutById };
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
			var element = nodeElements[id];
			element.classList.toggle("is-active", id === topicId);
			element.classList.toggle("is-related", id !== topicId && Boolean(relatedIds[id]));
			element.classList.toggle("is-dim", !relatedIds[id]);
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
			nodeElements[id].classList.remove("is-active", "is-related", "is-dim");
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
		title.textContent = "Interactive topic constellation";
		var description = makeSvgElement("desc", { id: graphDescriptionId });
		description.textContent = "Topic size represents post count. Lines connect topics that appear together in posts.";
		svg.appendChild(title);
		svg.appendChild(description);

		if (!topics.length) {
			emptyState.hidden = false;
			status.textContent = "No topics are available yet.";
			return;
		}
		emptyState.hidden = true;

		var layout = createLayout(width, height);
		var edgeLayer = makeSvgElement("g", { "aria-hidden": "true" });
		var nodeLayer = makeSvgElement("g", {});

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
				"class": "topic-edge" + (connection.weight >= 3 ? " is-strong" : "")
			});
			edgeLayer.appendChild(line);
			edgeElements.push({ element: line, connection: connection });
		});

		layout.nodes.forEach(function (node) {
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
			var dot = makeSvgElement("circle", { "class": "topic-node-dot", r: node.dotRadius.toFixed(2) });
			var label = makeSvgElement("text", {
				x: (node.dotRadius + 7).toFixed(2),
				y: ".35em",
				"font-size": node.fontSize.toFixed(2),
				"text-anchor": node.x > width - 165 ? "end" : "start"
			});
			if (node.x > width - 165) label.setAttribute("x", (-node.dotRadius - 7).toFixed(2));
			label.textContent = node.label;
			group.appendChild(hit);
			group.appendChild(dot);
			group.appendChild(label);
			link.appendChild(group);
			nodeLayer.appendChild(link);
			nodeElements[node.id] = link;

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

		svg.appendChild(edgeLayer);
		svg.appendChild(nodeLayer);
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
