/**********************************

SAVED MODELS — Firestore persistence

Collection: "savedModels"
Document: { userId, name, data, viewState, createdAt, updatedAt }

**********************************/

function SavedModels(loopy) {

    var self = this;
    self.loopy = loopy;
    var COLLECTION = "savedModels";
    var LOCAL_KEY = "flowcld_saved_models";

    function getUserId() {
        return window.currentUserId || null;
    }

    function fb() {
        return window.firebase;
    }

    function useLocal() {
        return !getUserId();
    }

    // ── localStorage helpers ──

    function _getLocalModels() {
        try {
            return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
        } catch(e) { return []; }
    }

    function _setLocalModels(models) {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(models));
    }

    // ── Save ──

    self.saveModel = function(name, callback) {
        if (!name || !name.trim()) { alert("Please enter a model name."); return; }

        var modelData = loopy.model.serialize();
        var viewState = JSON.stringify({
            scale: loopy.model.scale,
            offsetX: loopy.offsetX,
            offsetY: loopy.offsetY
        });

        if (useLocal()) {
            var models = _getLocalModels();
            var id = "local_" + Date.now();
            models.unshift({
                id: id,
                name: name.trim(),
                data: modelData,
                viewState: viewState,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
            _setLocalModels(models);
            if (callback) callback(null, id);
            return;
        }

        var f = fb();
        f.addDoc(f.collection(f.db, COLLECTION), {
            userId: getUserId(),
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

    // ── Update ──

    self.updateModel = function(docId, name, callback) {
        var modelData = loopy.model.serialize();
        var viewState = JSON.stringify({
            scale: loopy.model.scale,
            offsetX: loopy.offsetX,
            offsetY: loopy.offsetY
        });

        if (useLocal() || (docId && docId.indexOf("local_") === 0)) {
            var models = _getLocalModels();
            for (var i = 0; i < models.length; i++) {
                if (models[i].id === docId) {
                    models[i].data = modelData;
                    models[i].viewState = viewState;
                    models[i].updatedAt = new Date().toISOString();
                    if (name) models[i].name = name.trim();
                    break;
                }
            }
            _setLocalModels(models);
            if (callback) callback(null);
            return;
        }

        var userId = getUserId();
        if (!userId) { alert("You must be logged in to save."); return; }

        var f = fb();
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

    // ── List ──

    self.listModels = function(callback) {
        if (useLocal()) {
            var models = _getLocalModels().map(function(m) {
                return {
                    id: m.id,
                    name: m.name,
                    createdAt: m.createdAt ? new Date(m.createdAt) : null,
                    updatedAt: m.updatedAt ? new Date(m.updatedAt) : null
                };
            });
            callback(null, models);
            return;
        }

        var userId = getUserId();
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

    // ── Load ──

    self.loadModel = function(docId, callback) {
        if (docId && docId.indexOf("local_") === 0) {
            var models = _getLocalModels();
            var found = null;
            for (var i = 0; i < models.length; i++) {
                if (models[i].id === docId) { found = models[i]; break; }
            }
            if (!found) { callback(new Error("Model not found")); return; }
            try {
                var decoded = decodeURIComponent(found.data);
                loopy.model.deserialize(decoded);
                if (found.viewState) {
                    var view = JSON.parse(found.viewState);
                    loopy.offsetScale = view.scale;
                    loopy.offsetX = view.offsetX;
                    loopy.offsetY = view.offsetY;
                    loopy.model.scale = view.scale;
                    loopy.model.offsetX = view.offsetX;
                    loopy.model.offsetY = view.offsetY;
                    loopy.model.dirty();
                }
                self.currentModelId = docId;
                self.currentModelName = found.name;
                callback(null, found.name);
            } catch(e) {
                console.error("Load failed:", e);
                callback(e);
            }
            return;
        }

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

    // ── Delete ──

    self.deleteModel = function(docId, callback) {
        if (docId && docId.indexOf("local_") === 0) {
            var models = _getLocalModels().filter(function(m) { return m.id !== docId; });
            _setLocalModels(models);
            if (self.currentModelId === docId) {
                self.currentModelId = null;
                self.currentModelName = null;
            }
            if (callback) callback(null);
            return;
        }

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
    self.showMyModelsModal = function(targetDom) {
        var container = targetDom || document.getElementById("modal_page");
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

    // Prompt user and save (custom dialog to avoid browser blocking prompt())
    self.promptSave = function() {
        var defaultName = self.currentModelName || "";

        var overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.45);z-index:99999;display:flex;align-items:center;justify-content:center;";

        var dialog = document.createElement("div");
        dialog.style.cssText = "background:#fff;border-radius:12px;padding:28px 32px 20px;min-width:340px;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,0.18);font-family:'Inter',sans-serif;";

        dialog.innerHTML =
            '<h3 style="margin:0 0 16px;font-size:17px;font-weight:600;">Save Model</h3>' +
            '<input id="_save_name_input" type="text" placeholder="Enter model name" value="' + _escapeHtml(defaultName) + '" ' +
                'style="width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid #ccc;border-radius:7px;font-size:15px;font-family:inherit;outline:none;">' +
            '<div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end;">' +
                '<button id="_save_cancel_btn" style="padding:8px 18px;border:1px solid #ccc;border-radius:6px;background:#f5f5f5;cursor:pointer;font-size:14px;font-family:inherit;">Cancel</button>' +
                '<button id="_save_ok_btn" style="padding:8px 18px;border:none;border-radius:6px;background:#4a7cff;color:#fff;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;">Save</button>' +
            '</div>';

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        var input = document.getElementById("_save_name_input");
        input.focus();
        input.select();

        function cleanup() {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }

        function doSave() {
            var name = input.value;
            if (!name || !name.trim()) {
                input.style.borderColor = "#e74c3c";
                input.focus();
                return;
            }
            cleanup();

            if (self.currentModelId) {
                var overwrite = confirm("Overwrite '" + self.currentModelName + "'?\nClick Cancel to save as a new copy.");
                if (overwrite) {
                    self.updateModel(self.currentModelId, name, function(err) {
                        if (err) alert("Save failed: " + err.message);
                        else {
                            self.currentModelName = name;
                            alert("Model updated.");
                        }
                    });
                    return;
                }
            }

            self.saveModel(name, function(err, id) {
                if (err) alert("Save failed: " + err.message);
                else {
                    self.currentModelId = id;
                    self.currentModelName = name;
                    alert("Model saved.");
                }
            });
        }

        document.getElementById("_save_ok_btn").onclick = doSave;
        document.getElementById("_save_cancel_btn").onclick = cleanup;
        overlay.addEventListener("click", function(e) {
            if (e.target === overlay) cleanup();
        });
        input.addEventListener("keydown", function(e) {
            if (e.key === "Enter") doSave();
            if (e.key === "Escape") cleanup();
        });
    };
}

function _escapeHtml(str) {
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}
