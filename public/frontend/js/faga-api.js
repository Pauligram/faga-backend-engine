/**
 * FAGA Core Application Suite API Management Wrapper
 * Fully calibrated to dynamically map your production Railway infrastructure.
 */

const FAGA_API_BASE_URL = "https://railway.app";

const FagaAPI = {

    /* =========================================
       TOKEN MANAGEMENT
    ========================================= */

    getToken() {
        return localStorage.getItem("faga_auth_token");
    },

    setToken(token) {
        localStorage.setItem("faga_auth_token", token);
    },

    removeToken() {
        localStorage.removeItem("faga_auth_token");
    },

    /* =========================================
       COMMON API REQUEST
    ========================================= */

    async request(endpoint, options = {}) {
        const token = this.getToken();

        const headers = {
            "Accept": "application/json",
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {})
        };

        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        let response;

        try {
            // FIX: Dynamic link reconstruction using your production base URL token
            response = await fetch(`${FAGA_API_BASE_URL}${endpoint}`, {
                ...options,
                headers
            });
        } catch (networkError) {
            console.error("FAGA API network error:", networkError);
            throw {
                status: 0,
                data: { message: "Unable to connect to the FAGA backend." }
            };
        }

        let data = {};
        try {
            data = await response.json();
        } catch (error) {
            data = {};
        }

        if (!response.ok) {
            if (response.status === 401) {
                this.removeToken();
            }
            throw {
                status: response.status,
                data: data
            };
        }

        return data;
    },

    /* =========================================
       AUTHENTICATION
    ========================================= */

    async register(name, email, password, passwordConfirmation = null) {
        const data = await this.request("/register", {
            method: "POST",
            body: JSON.stringify({
                name: name,
                email: email,
                password: password,
                password_confirmation: passwordConfirmation ?? password
            })
        });

        if (data.token) {
            this.setToken(data.token);
        }
        return data;
    },

    async login(email, password) {
        const data = await this.request("/login", {
            method: "POST",
            body: JSON.stringify({
                email: email,
                password: password
            })
        });

        if (data.token) {
            this.setToken(data.token);
        }
        return data;
    },

    async me() {
        return this.request("/me", { method: "GET" });
    },

    async logout() {
        try {
            const data = await this.request("/logout", { method: "POST" });
            this.removeToken();
            return data;
        } catch (error) {
            this.removeToken();
            throw error;
        }
    },

    isLoggedIn() {
        return !!this.getToken();
    },

    /* =========================================
       PROFILE
    ========================================= */

    async getProfile() {
        return this.request("/profile", { method: "GET" });
    },

    async updateProfile(profileData) {
        return this.request("/profile", {
            method: "PATCH",
            body: JSON.stringify(profileData)
        });
    },

    /* =========================================
       ADDRESSES
    ========================================= */

    async getAddresses() {
        return this.request("/addresses", { method: "GET" });
    },

    async getAddress(id) {
        return this.request(`/addresses/${id}`, { method: "GET" });
    },

    async createAddress(addressData) {
        return this.request("/addresses", {
            method: "POST",
            body: JSON.stringify(addressData)
        });
    },

    async updateAddress(id, addressData) {
        return this.request(`/addresses/${id}`, {
            method: "PATCH",
            body: JSON.stringify(addressData)
        });
    },

    async deleteAddress(id) {
        return this.request(`/addresses/${id}`, { method: "DELETE" });
    },

    async setDefaultAddress(id) {
        return this.request(`/addresses/${id}/default`, { method: "PATCH" });
    },

    /* =========================================
       DELIVERIES
    ========================================= */

    async getDeliveries() {
        return this.request("/deliveries", { method: "GET" });
    },

    async getDelivery(id) {
        return this.request(`/deliveries/${id}`, { method: "GET" });
    },

    async createDelivery(deliveryData) {
        return this.request("/deliveries", {
            method: "POST",
            body: JSON.stringify(deliveryData)
        });
    },

    async getDeliveryStatus(id) {
        return this.request(`/deliveries/${id}/status`, { method: "GET" });
    },

    async updateDeliveryStatus(id, statusData) {
        return this.request(`/deliveries/${id}/status`, {
            method: "PATCH",
            body: JSON.stringify(statusData)
        });
    },

    async assignDeliveryRider(id, riderId) {
        return this.request(`/deliveries/${id}/assign-rider`, {
            method: "PATCH",
            body: JSON.stringify({ rider_id: riderId })
        });
    },

    /* =========================================
       JOBS
    ========================================= */

    async getJobs(params = "") {
        return this.request(`/jobs${params}`, { method: "GET" });
    },

    async getJob(id) {
        return this.request(`/jobs/${id}`, { method: "GET" });
    },

    async applyForJob(id, applicationData = {}) {
        return this.request(`/jobs/${id}/apply`, {
            method: "POST",
            body: JSON.stringify(applicationData)
        });
    },

    async getMyJobApplications() {
        return this.request("/job-applications/me", { method: "GET" });
    },

    async getCurrentJobSubscription() {
        return this.request("/job-subscriptions/current", { method: "GET" });
    },

        /* =========================================
       RIDE BOOKING ENGINES
    ========================================= */

    async requestRide(rideData) {
        return this.request("/rides", {
            method: "POST",
            body: JSON.stringify(rideData)
        });
    },

    async getRides() {
        return this.request("/rides", {
            method: "GET"
        });
    },

    async getRide(id) {
        return this.request(`/rides/${id}`, {
            method: "GET"
        });
    },

    async cancelRide(id, reason = null) {
        return this.request(`/rides/${id}/cancel`, {
            method: "PATCH",
            body: JSON.stringify({
                reason: reason
            })
        });
    },

    async getRideStatus(id) {
        return this.request(`/rides/${id}/status`, {
            method: "GET"
        });
    },

    /* =========================================
       CONNECTION HANDSHAKE TEST
    ========================================= */

    async testConnection() {
        return this.request("/me", {
            method: "GET"
        });
    }
};

// ==========================================
// STEP C: FRONTEND LIVE TELEMETRY TRACKING BINDINGS
// ==========================================

const FagaLiveTracking = {
    /**
     * Activates the client device location loop to map the dispatcher courier.
     * Evaluates live telemetry state entries every 4 seconds.
     * 
     * @param {number} rideId - Unique operational ride ledger identifier.
     * @param {function} onLocationReceived - Callback routing coordinates directly onto map templates.
     * @param {function} onError - Fallback intercept routine handler.
     * @returns {number} Tracking interval stack reference token.
     */
    startTrackingDriver(rideId, onLocationReceived, onError) {
        // Force an immediate layout canvas coordinate capture on initialization
        this._fetchCurrentCoordinates(rideId, onLocationReceived, onError);

        // Chain the automated continuous background pooling loop
        const trackingIntervalId = setInterval(() => {
            this._fetchCurrentCoordinates(rideId, onLocationReceived, onError);
        }, 4000);

        return trackingIntervalId;
    },

    /**
     * Intercepts and parses real-time coordinates from the active database cluster.
     */
    async _fetchCurrentCoordinates(rideId, successCallback, errorCallback) {
        try {
            // Synchronized authentication token lookup key
            const token = localStorage.getItem('faga_auth_token');
            
            // FIXED: Connected directly to your live production Railway endpoint instead of a broken local route
            const response = await fetch(`${FAGA_API_BASE_URL}/telemetry/stream/${rideId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Server returned error status code: ${response.status}`);
            }

            const result = await response.json();
            
            if (result.success && result.data) {
                // Pipe pristine global coordinates straight onto your mapping layout canvas
                successCallback(result.data.latitude, result.data.longitude);
            }
        } catch (error) {
            console.error("FAGA live map tracking signal error logs trace:", error);
            if (errorCallback) errorCallback(error);
        }
    },

    /**
     * Deactivates the live tracking stream securely once the delivery checkout achieves completion.
     * @param {number} intervalId - Tracking loop handle token.
     */
    stopTrackingDriver(intervalId) {
        clearInterval(intervalId);
        console.log("FAGA tracking system turned off safely.");
    }
};
