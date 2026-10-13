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

	function seededFraction(seed, salt) {
		return hashString(seed + ":" + salt) / 4294967296;
	}

	function createLayout(width, height) {
		var maxCount = topics.reduce(function (largest, topic) {
			return Math.max(largest, topic.count);
		}, 1);
		var labelLimit = width < 500 ? 9 : (width < 760 ? 20 : 30);
		var padding = width < 500 ? 30 : 46;
		var centerX = width / 2;
		var centerY = height / 2;
		var cloudWidth = Math.max(120, width - (padding * 2));
		var cloudHeight = Math.max(120, height - (padding * 2));
		var lobes = [
			{ x: -.30, y: .02, rx: .14, ry: .13 },
			{ x: -.14, y: -.14, rx: .18, ry: .12 },
			{ x: .02, y: -.04, rx: .20, ry: .15 },
			{ x: .27, y: -.05, rx: .16, ry: .14 },
			{ x: -.10, y: .13, rx: .18, ry: .11 },
			{ x: .15, y: .14, rx: .16, ry: .11 }
		];
		var nodes = topics.map(function (topic, index) {
			var seed = hashString(topic.id);
			var lobe = lobes[seed % lobes.length];
			var angle = seededFraction(topic.id, "angle") * Math.PI * 2;
			var radius = Math.sqrt(seededFraction(topic.id, "radius"));
			var importance = Math.log(topic.count + 1) / Math.log(maxCount + 1);
			var centerBias = 1 - (importance * .66);
			var lobeX = centerX + (lobe.x * cloudWidth * centerBias);
			var lobeY = centerY + (lobe.y * cloudHeight * centerBias);
			var organicX = Math.cos(angle) * lobe.rx * cloudWidth * radius * centerBias;
			var organicY = Math.sin(angle) * lobe.ry * cloudHeight * radius * centerBias;
			var ripple = Math.sin((angle * 3) + ((seed % 13) / 13)) * .035;
			var fontSize = topicScale(topic.count, width < 500 ? 13 : 12, width < 500 ? 20 : 29, maxCount);
			var initialX = lobeX + organicX + (ripple * cloudWidth);
			var initialY = lobeY + organicY - (ripple * cloudHeight * .55);
			return {
				id: topic.id,
				label: topic.label,
				url: topic.url,
				count: topic.count,
				index: index,
				labeled: index < labelLimit,
				fontSize: fontSize,
				labelWidth: Math.min(190, topic.label.length * fontSize * .55),
				labelSide: initialX < centerX ? -1 : 1,
				dotRadius: topicScale(topic.count, 2.5, 7.5, maxCount),
				x: initialX,
				y: initialY,
				anchorX: initialX,
				anchorY: initialY,
				vx: 0,
				vy: 0
			};
		});
		var layoutById = {};
		nodes.forEach(function (node) { layoutById[node.id] = node; });
		var layoutEdges = connections.filter(function (connection) {
			return connection.weight >= 2 && layoutById[connection.source] && layoutById[connection.target];
		});

		for (var iteration = 0; iteration < 170; iteration += 1) {
			var cooling = 1 - (iteration / 170);
			for (var first = 0; first < nodes.length; first += 1) {
				for (var second = first + 1; second < nodes.length; second += 1) {
					var firstNode = nodes[first];
					var secondNode = nodes[second];
					var dx = secondNode.x - firstNode.x;
					var dy = secondNode.y - firstNode.y;
					var distanceSquared = Math.max(36, (dx * dx) + (dy * dy));
					var distance = Math.sqrt(distanceSquared);
					var repulsion = (width < 500 ? 250 : 700) / distanceSquared;
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
				var desired = Math.max(104, 174 - (Math.min(connection.weight, 8) * 7));
				var pull = (distance - desired) * .0005 * cooling;
				var pullX = (dx / distance) * pull;
				var pullY = (dy / distance) * pull;
				source.vx += pullX;
				source.vy += pullY;
				target.vx -= pullX;
				target.vy -= pullY;
			});

			nodes.forEach(function (node) {
				var anchorStrength = width < 500 ? .015 : .009;
				node.vx += (node.anchorX - node.x) * anchorStrength * cooling;
				node.vy += (node.anchorY - node.y) * anchorStrength * cooling;
				if (node.x < padding) node.vx += (padding - node.x) * .015;
				if (node.x > width - padding) node.vx -= (node.x - (width - padding)) * .015;
				if (node.y < padding) node.vy += (padding - node.y) * .015;
				if (node.y > height - padding) node.vy -= (node.y - (height - padding)) * .015;
				node.vx *= .82;
				node.vy *= .82;
				node.x += node.vx;
				node.y += node.vy;
			});
		}

		function constrainNode(node) {
			var edgeVariation = seededFraction(node.id, "edge") * 18;
			var labelWidth = node.labeled ? node.labelWidth : 0;
			var leftLimit = padding + edgeVariation;
			var rightLimit = width - padding - edgeVariation - labelWidth;
			if (node.labelSide < 0) {
				leftLimit += labelWidth;
				rightLimit += labelWidth;
			}
			node.x = Math.max(leftLimit, Math.min(rightLimit, node.x));
			node.y = Math.max(padding + edgeVariation, Math.min(height - padding - edgeVariation, node.y));
		}

		nodes.forEach(constrainNode);

		for (var settle = 0; settle < 44; settle += 1) {
			for (var labelFirst = 0; labelFirst < labelLimit; labelFirst += 1) {
				for (var labelSecond = labelFirst + 1; labelSecond < labelLimit; labelSecond += 1) {
					var firstLabel = nodes[labelFirst];
					var secondLabel = nodes[labelSecond];
					var firstCenterX = firstLabel.x + (firstLabel.labelSide * (firstLabel.dotRadius + 7 + (firstLabel.labelWidth / 2)));
					var secondCenterX = secondLabel.x + (secondLabel.labelSide * (secondLabel.dotRadius + 7 + (secondLabel.labelWidth / 2)));
					var labelDx = secondCenterX - firstCenterX;
					var labelDy = secondLabel.y - firstLabel.y;
					var overlapX = ((firstLabel.labelWidth + secondLabel.labelWidth) / 2) + 12 - Math.abs(labelDx);
					var overlapY = ((firstLabel.fontSize + secondLabel.fontSize) / 2) + 8 - Math.abs(labelDy);
					if (overlapX > 0 && overlapY > 0) {
						if (width >= 500 && overlapX < overlapY) {
							var horizontalDirection = labelDx >= 0 ? 1 : -1;
							var horizontalShift = (overlapX / 2) + 1;
							firstLabel.x -= horizontalShift * horizontalDirection;
							secondLabel.x += horizontalShift * horizontalDirection;
						} else {
							var verticalDirection = labelDy >= 0 ? 1 : -1;
							var verticalShift = (overlapY / 2) + 1;
							firstLabel.y -= verticalShift * verticalDirection;
							secondLabel.y += verticalShift * verticalDirection;
						}
					}
				}
			}
		}

		nodes.forEach(constrainNode);

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
		title.textContent = "Interactive topic cloud";
		var description = makeSvgElement("desc", { id: graphDescriptionId });
		description.textContent = "Topics form an organic cloud. Topic size represents post count, and lines connect topics that appear together in posts.";
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
		var dotLayer = makeSvgElement("g", { "aria-hidden": "true" });
		var labelLayer = makeSvgElement("g", {});

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
			var label = makeSvgElement("text", {
				x: (node.labelSide * (node.dotRadius + 7)).toFixed(2),
				y: ".35em",
				"font-size": node.fontSize.toFixed(2),
				"text-anchor": node.labelSide < 0 ? "end" : "start"
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
