window.adminPanel = {

    async grantAccess(email) {
        const { db, collection, query, where, getDocs, updateDoc, doc } = window.firebase;
        const snap = await getDocs(query(collection(db, 'users'), where('email', '==', email.trim().toLowerCase())));
        if (snap.empty) return { success: false, message: `No account found for ${email}` };
        await updateDoc(doc(db, 'users', snap.docs[0].id), { researcher: true });
        return { success: true, message: `Researcher access granted to ${email}` };
    },

    async revokeAccess(email) {
        const { db, collection, query, where, getDocs, updateDoc, doc } = window.firebase;
        const snap = await getDocs(query(collection(db, 'users'), where('email', '==', email.trim().toLowerCase())));
        if (snap.empty) return { success: false, message: `No account found for ${email}` };
        await updateDoc(doc(db, 'users', snap.docs[0].id), { researcher: false });
        return { success: true, message: `Researcher access revoked for ${email}` };
    },

    async listResearchers() {
        const { db, collection, query, where, getDocs } = window.firebase;
        const snap = await getDocs(query(collection(db, 'users'), where('researcher', '==', true)));
        return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    },

    async renderPanel() {
        const container = document.getElementById('adminPanelContent');
        if (!container) return;
        container.innerHTML = '<p>Loading...</p>';

        try {
            const researchers = await this.listResearchers();

            let listHTML = researchers.length === 0
                ? '<p style="color:#888;">No users currently have researcher access.</p>'
                : '<ul style="list-style:none;padding:0;margin:0;">' +
                    researchers.map(r => `
                        <li style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eee;">
                            <span>${r.email || r.userName || r.uid}</span>
                            <button class="button" style="background:#e53e3e;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;"
                                onclick="adminPanel._quickRevoke('${r.email}', this)">Revoke</button>
                        </li>`).join('') +
                  '</ul>';

            container.innerHTML = `
                <div class="analysis-controls">
                    <div class="control-row">
                        <input type="email" id="adminEmailInput" placeholder="student@example.com" style="flex:1;padding:8px;border:1px solid #ccc;border-radius:4px;">
                        <button class="button" onclick="adminPanel._handleGrant()">Grant</button>
                        <button class="button" style="background:#e53e3e;color:#fff;border:none;" onclick="adminPanel._handleRevoke()">Revoke</button>
                    </div>
                    <div id="adminActionMessage" style="margin-top:8px;font-size:14px;min-height:20px;"></div>
                </div>
                <hr class="section-divider">
                <h3>Current Researcher Access (${researchers.length})</h3>
                ${listHTML}
            `;
        } catch (err) {
            container.innerHTML = `<p style="color:red;">Error: ${err.message}</p>`;
        }
    },

    async _handleGrant() {
        const email = document.getElementById('adminEmailInput')?.value;
        const msg = document.getElementById('adminActionMessage');
        if (!email) return;
        msg.textContent = 'Processing...';
        const result = await this.grantAccess(email);
        msg.textContent = result.message;
        msg.style.color = result.success ? 'green' : 'red';
        if (result.success) this.renderPanel();
    },

    async _handleRevoke() {
        const email = document.getElementById('adminEmailInput')?.value;
        const msg = document.getElementById('adminActionMessage');
        if (!email) return;
        msg.textContent = 'Processing...';
        const result = await this.revokeAccess(email);
        msg.textContent = result.message;
        msg.style.color = result.success ? 'green' : 'red';
        if (result.success) this.renderPanel();
    },

    async _quickRevoke(email, btn) {
        btn.textContent = 'Revoking...';
        btn.disabled = true;
        const result = await this.revokeAccess(email);
        if (result.success) this.renderPanel();
        else { btn.textContent = 'Revoke'; btn.disabled = false; }
    }
};
