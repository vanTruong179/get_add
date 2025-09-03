const express = require("express");
const axios = require("axios");
const pLimit = require("p-limit");
const NodeCache = require("node-cache");
const axiosRetry = require("axios-retry").default;
const path = require("path");
const open = require("open");

const app = express();
const cache = new NodeCache({ stdTTL: 3600 });

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

const PORT = 3000;

const axiosInstance = axios.create({
    timeout: 5000,
    headers: {
        "Accept-Encoding": "gzip, deflate, br"
    }
});

axiosRetry(axiosInstance, {
    retries: 3,
    retryDelay: (retryCount) => retryCount * 1000,
    retryCondition: (error) => axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status === 429
});

async function fetchOrderData(orderId, authToken) {
    const cacheKey = `order_${orderId}`;
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
        return cachedData;
    }

    const headers = {
        "Content-Type": "application/json;charset=utf-8",
        "Origin": "https://jms.jtexpress.vn",
        "Referer": "https://jms.jtexpress.vn/",
        "authToken": authToken,
        "lang": "VN",
        "langType": "VN",
        "timezone": "GMT+0700",
        "routeName": "trackingExpress",
    };

    try {
        const [detailRes, trackingRes] = await Promise.all([
            axiosInstance.post("https://jmsgw.jtexpress.vn/operatingplatform/order/getOrderDetail", {
                waybillNo: orderId, countryId: "1"
            }, { headers }),
            axiosInstance.post("https://jmsgw.jtexpress.vn/operatingplatform/podTracking/inner/query/keywordList", {
                keywordList: [orderId], trackingTypeEnum: "WAYBILL", countryId: "1"
            }, { headers })
        ]);

        const details = detailRes.data?.data?.details || {};
        let trackingRecords = trackingRes.data?.data?.[0]?.details || [];
        const latestRecord = trackingRecords.reduce((latest, record) => {
            if (!latest || new Date(record.scanTime) > new Date(latest.scanTime)) {
                return record;
            }
            return latest;
        }, null) || {};

        const result = {
            orderId,
            receiverName: details.receiverName || "Không có",
            receiverAddress: details.receiverDetailedAddress || "Không có",
            terminalDispatchCode: details.terminalDispatchCode || "Không có",
            scanTypeName: latestRecord.scanTypeName || "Không có"
        };

        cache.set(cacheKey, result);
        return result;
    } catch (err) {
        console.error(`❌ Lỗi khi xử lý orderId: ${orderId}`, err.message);
        return { orderId, error: "Không lấy được dữ liệu" };
    }
}

app.post("/api/tracking", async (req, res) => {
    const { orderIds, authToken } = req.body;
    if (!authToken) return res.status(400).json({ error: "Cần nhập authToken" });
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ error: "Cần nhập ít nhất một mã đơn" });
    }

    const limit = pLimit(10);
    const tasks = orderIds.map(orderId => limit(() => fetchOrderData(orderId, authToken)));
    const results = await Promise.all(tasks);

    res.json(results);
});

app.listen(PORT, () => {
    console.log(`Server chạy tại http://localhost:${PORT}`);
    open(`http://localhost:${PORT}`);
});