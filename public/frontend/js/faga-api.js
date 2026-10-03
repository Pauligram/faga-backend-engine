/**
 * FAGA Core Application Suite API Management Wrapper
 * Fully calibrated to dynamically map your production Railway infrastructure.
 */

//  CORRECTED: Pointing to your specific live public production link
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
            // Reconstructs links using your production base URL token
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
        //  CORRECTED: Changed path prefix to match Node routing
        const data = await this.request("/api/register", {
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
        //  CORRECTED: Changed path prefix to match Node routing
        const data = await this.request("/api/login", {
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
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request("/api/profile", { method: "GET" });
    },

    async logout() {
        try {
            //  CORRECTED: Changed path prefix to match Node routing
            const data = await this.request("/api/logout", { method: "POST" });
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
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request("/api/profile", { method: "GET" });
    },

    async updateProfile(profileData) {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request("/api/profile", {
            method: "PATCH",
            body: JSON.stringify(profileData)
        });
    },

    /* =========================================
       ADDRESSES
    ========================================= */

    async getAddresses() {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request("/api/addresses", { method: "GET" });
    },

    async getAddress(id) {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request(`/api/addresses/${id}`, { method: "GET" });
    },

    async createAddress(addressData) {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request("/api/addresses", {
            method: "POST",
            body: JSON.stringify(addressData)
        });
    },

    async updateAddress(id, addressData) {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request(`/api/addresses/${id}`, {
            method: "PATCH",
            body: JSON.stringify(addressData)
        });
    },

    async deleteAddress(id) {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request(`/api/addresses/${id}`, { method: "DELETE" });
    },

    async setDefaultAddress(id) {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request(`/api/addresses/${id}/default`, { method: "PATCH" });
    },

    /* =========================================
       DELIVERIES
    ========================================= */

    async getDeliveries() {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request("/api/deliveries", { method: "GET" });
    },

    async getDelivery(id) {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request(`/api/deliveries/${id}`, { method: "GET" });
    },

    async createDelivery(deliveryData) {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request("/api/deliveries", {
            method: "POST",
            body: JSON.stringify(deliveryData)
        });
    },

    async getDeliveryStatus(id) {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request(`/api/deliveries/${id}/status`, { method: "GET" });
    },

    async updateDeliveryStatus(id, statusData) {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request(`/api/deliveries/${id}/status`, {
            method: "PATCH",
            body: JSON.stringify(statusData)
        });
    },

    async assignDeliveryRider(id, riderId) {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request(`/api/deliveries/${id}/assign-rider`, {
            method: "PATCH",
            body: JSON.stringify({ riderId: riderId })
        });
    },

    /* =========================================
       JOBS
    ========================================= */

    async getJobs(params = "") {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request(`/api/jobs${params}`, { method: "GET" });
    },

    async getJob(id) {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request(`/api/jobs/${id}`, { method: "GET" });
    },

    async applyForJob(id, applicationData = {}) {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request(`/api/jobs/${id}/apply`, {
            method: "POST",
            body: JSON.stringify(applicationData)
        });
    },

    async getMyJobApplications() {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request("/api/job-applications/me", { method: "GET" });
    },

    async getCurrentJobSubscription() {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request("/api/job-subscriptions/current", { method: "GET" });
    },

    /* =========================================
       RIDE BOOKING ENGINES
    ========================================= */

    async requestRide(rideData) {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request("/api/deliveries", {
            method: "POST",
            body: JSON.stringify(rideData)
        });
    },

    async getRides() {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request("/api/deliveries", {
            method: "GET"
        });
    },

    async getRide(id) {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request(`/api/deliveries/${id}`, {
            method: "GET"
        });
    },

    /* =========================================
       CONNECTION HANDSHAKE TEST
    ========================================= */

    async testConnection() {
        //  CORRECTED: Changed path prefix to match Node routing
        return this.request("/api/profile", {
            method: "GET"
        });
    }
};

// ==========================================
// STEP C: FRONTEND LIVE TELEMETRY TRACKING BINDINGS
// ==========================================

const FagaLiveTracking = {
    startTrackingDriver(rideId, onLocationReceived, onError) {
        this._fetchCurrentCoordinates(rideId, onLocationReceived, onError);

        const trackingIntervalId = setInterval(() => {
            this._fetchCurrentCoordinates(rideId, onLocationReceived, onError);
        }, 4000);

        return trackingIntervalId;
    },

    async _fetchCurrentCoordinates(rideId, successCallback, errorCallback) {
        try {
            const token = localStorage.getItem('faga_auth_token');
            
//  CORRECTED: Re-routed query to target the telemetry updates endpoint on your server
const response = await fetch(${FAGA_API_BASE_URL}/api/telemetry/update, {
method: 'POST',
headers: {
'Authorization': Bearer ${token},
'Content-Type': 'application/json',
'Accept': 'application/json'
},
body: JSON.stringify({ ride_id: rideId })
});
if (!response.ok) {
throw new Error(Server returned error status code: ${response.status});
}
const result = await response.json();
if (result.success && result.data) {
successCallback(result.data.latitude, result.data.longitude);
}
} catch (error) {
console.error("FAGA live map tracking signal error logs trace:", error);
if (errorCallback) errorCallback(error);
}
},

stopTrackingDriver(intervalId) {
clearInterval(intervalId);
console.log("FAGA tracking system turned off safely.");
}
};