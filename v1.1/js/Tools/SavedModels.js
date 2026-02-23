/**********************************

SAVED MODELS — Firestore persistence

Collection: "savedModels"
Document: { userId, name, data, viewState, createdAt, updatedAt }

**********************************/

function SavedModels(loopy) {

    var self = this;
    self.loopy = loopy;
    var COLLECTION = "savedModels";

    function getUserId() {
        return window.currentUserId || null;
    }

    function fb() {
        return window.firebase;
    }

    // Save current model to Firestore
    self.saveModel = function(name, callback) {
        var userId = getUserId();
        if (!userId) { alert("You must be logged in to save."); return; }
        if (!name || !name.trim()) { alert("Please enter a model name."); return; }

        var f = fb();
        var modelData = loopy.model.serialize();
        var viewState = JSON.stringify({
            scale: loopy.model.scale,
            offsetX: loopy.offsetX,
            offsetY: loopy.offsetY
        });

        f.addDoc(f.collection(f.db, COLLECTION), {
            userId: userId,
            name: name.trim(),
            data: modelData,
            viewState: viewState,
            createdAt: f.serverTimestamp(),
            updatedAt: f.serverTimestamp()
        }).then(function(docRef) {
            console.log("Model saved:", docRef.id);
            if (callback) callback(null, docRef.id);
        }).catch(function(err) {
            console.error("Save failed:", err);
            if (callback) callback(err);
        });
    };

    // Overwrite an existing saved model
    self.updateModel = function(docId, name, callback) {
        var userId = getUserId();
        if (!userId) { alert("You must be logged in to save."); return; }

        var f = fb();
        var modelData = loopy.model.serialize();
        var viewState = JSON.stringify({
            scale: loopy.model.scale,
            offsetX: loopy.offsetX,
            offsetY: loopy.offsetY
        });

        var updates = {
            data: modelData,
            viewState: viewState,
            updatedAt: f.serverTimestamp()
        };
        if (name) updates.name = name.trim();

        f.updateDoc(f.doc(f.db, COLLECTION, docId), updates)
        .then(function() {
            console.log("Model updated:", docId);
            if (callback) callback(null);
        }).catch(function(err) {
            console.error("Update failed:", err);
            if (callback) callback(err);
        });
    };

    // List all models for the current user
    self.listModels = function(callback) {
        var userId = getUserId();
        if (!userId) { callback(new Error("Not logged in")); return; }

        var f = fb();
        var q = f.query(
            f.collection(f.db, COLLECTION),
            f.where("userId", "==", userId),
            f.orderBy("updatedAt", "desc")
        );

        f.getDocs(q).then(function(snapshot) {
            var models = [];
            snapshot.forEach(function(doc) {
                var d = doc.data();
                models.push({
                    id: doc.id,
                    name: d.name,
                    createdAt: d.createdAt ? d.createdAt.toDate() : null,
                    updatedAt: d.updatedAt ? d.updatedAt.toDate() : null
                });
            });
            callback(null, models);
        }).catch(function(err) {
            console.error("List failed:", err);
            callback(err);
        });
    };

    // Load a model by document ID
    self.loadModel = function(docId, callback) {
        var f = fb();
        f.getDoc(f.doc(f.db, COLLECTION, docId)).then(function(snap) {
            if (!snap.exists()) {
                callback(new Error("Model not found"));
                return;
            }
            var d = snap.data();
            try {
                var decoded = decodeURIComponent(d.data);
                loopy.model.deserialize(decoded);

                if (d.viewState) {
                    var view = JSON.parse(d.viewState);
                    loopy.offsetScale = view.scale;
                    loopy.offsetX = view.offsetX;
                    loopy.offsetY = view.offsetY;
                    loopy.model.scale = view.scale;
                    loopy.model.offsetX = view.offsetX;
                    loopy.model.offsetY = view.offsetY;
                    loopy.model.dirty();
                }
                // Track currently loaded model for "overwrite save"
                self.currentModelId = docId;
                self.currentModelName = d.name;

                callback(null, d.name);
            } catch(e) {
                console.error("Load failed:", e);
                callback(e);
            }
        }).catch(function(err) {
            console.error("Load failed:", err);
            callback(err);
        });
    };

    // Delete a saved model
    self.deleteModel = function(docId, callback) {
        var f = fb();
        f.deleteDoc(f.doc(f.db, COLLECTION, docId)).then(function() {
            console.log("Model deleted:", docId);
            if (self.currentModelId === docId) {
                self.currentModelId = null;
                self.currentModelName = null;
            }
            if (callback) callback(null);
        }).catch(function(err) {
            console.error("Delete failed:", err);
            if (callback) callback(err);
        });
    };

    // Track which model is currently loaded
    self.currentModelId = null;
    self.currentModelName = null;

    // Populate the "My Models" modal content (called by Modal.onshow, not directly)
    self.showMyModelsModal = function() {
        var container = document.getElementById("modal_page");
        container.innerHTML = "<h2>My Saved Models</h2><p>Loading...</p>";

        self.listModels(function(err, models) {
            if (err) {
                container.innerHTML = "<h2>My Saved Models</h2><p style='color:red;'>Failed to load models. Make sure you're logged in.</p>";
                return;
            }

            var html = "<h2>My Saved Models</h2>";
            if (models.length === 0) {
                html += "<p>No saved models yet. Use 'Save Model' to save your first one.</p>";
            } else {
                html += "<div style='max-height:400px; overflow-y:auto;'>";
                html += "<table style='width:100%; border-collapse:collapse;'>";
                html += "<tr><th style='text-align:left; padding:8px; border-bottom:2px solid #ccc;'>Name</th>";
                html += "<th style='text-align:left; padding:8px; border-bottom:2px solid #ccc;'>Last Updated</th>";
                html += "<th style='padding:8px; border-bottom:2px solid #ccc;'>Actions</th></tr>";
                for (var i = 0; i < models.length; i++) {
                    var m = models[i];
                    var dateStr = m.updatedAt ? m.updatedAt.toLocaleDateString() + " " + m.updatedAt.toLocaleTimeString() : "—";
                    html += "<tr style='border-bottom:1px solid #eee;'>";
                    html += "<td style='padding:8px; font-weight:bold;'>" + _escapeHtml(m.name) + "</td>";
                    html += "<td style='padding:8px; color:#666; font-size:0.9em;'>" + dateStr + "</td>";
                    html += "<td style='padding:8px; text-align:center;'>";
                    html += "<span class='mini_button' data-load-id='" + m.id + "' data-load-name='" + _escapeHtml(m.name) + "'>Load</span> ";
                    html += "<span class='mini_button' data-delete-id='" + m.id + "' data-delete-name='" + _escapeHtml(m.name) + "' style='color:#c0392b;'>Delete</span>";
                    html += "</td></tr>";
                }
                html += "</table></div>";
            }
            container.innerHTML = html;

            // Bind load buttons
            var loadBtns = container.querySelectorAll("[data-load-id]");
            for (var j = 0; j < loadBtns.length; j++) {
                loadBtns[j].addEventListener("click", function() {
                    var id = this.getAttribute("data-load-id");
                    var name = this.getAttribute("data-load-name");
                    self.loadModel(id, function(err) {
                        if (err) {
                            alert("Failed to load model.");
                        } else {
                            loopy.modal.hide();
                            loopy.model.dirty();
                        }
                    });
                });
            }

            // Bind delete buttons
            var delBtns = container.querySelectorAll("[data-delete-id]");
            for (var k = 0; k < delBtns.length; k++) {
                delBtns[k].addEventListener("click", function() {
                    var id = this.getAttribute("data-delete-id");
                    var name = this.getAttribute("data-delete-name");
                    if (confirm("Delete '" + name + "'? This cannot be undone.")) {
                        self.deleteModel(id, function(err) {
                            if (!err) self.showMyModelsModal();
                        });
                    }
                });
            }
        });
    };

    // Prompt user and save
    self.promptSave = function() {
        var defaultName = self.currentModelName || "";
        var name = prompt("Model name:", defaultName);
        if (name === null) return;

        if (self.currentModelId && confirm("Overwrite '" + self.currentModelName + "'?\nClick Cancel to save as a new copy.")) {
            self.updateModel(self.currentModelId, name, function(err) {
                if (err) alert("Save failed: " + err.message);
                else {
                    self.currentModelName = name;
                    alert("Model updated.");
                }
            });
        } else {
            self.saveModel(name, function(err, id) {
                if (err) alert("Save failed: " + err.message);
                else {
                    self.currentModelId = id;
                    self.currentModelName = name;
                    alert("Model saved.");
                }
            });
        }
    };
}

function _escapeHtml(str) {
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}
