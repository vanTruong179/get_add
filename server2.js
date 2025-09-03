const express = require("express");
const axios = require("axios");
const pLimit = require("p-limit");

const app = express();

const path = require("path");

// phục vụ file tĩnh trong thư mục public
app.use(express.static(path.join(__dirname, "public")));

const PORT = 3000;

app.use(express.json());

const axiosInstance = axios.create({
    timeout: 5000, // 5 giây
});

async function fetchOrderData(orderId, authToken) {
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
        // Gọi API 1 và API 2 song song
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
        trackingRecords = trackingRecords.sort((a, b) => new Date(b.scanTime) - new Date(a.scanTime));
        const latestRecord = trackingRecords[0] || {};

        return {
            orderId,
            receiverName: details.receiverName || "Không có",
            receiverAddress: details.receiverDetailedAddress || "Không có",
            terminalDispatchCode: details.terminalDispatchCode || "Không có",
            scanTypeName: latestRecord.scanTypeName || "Không có"
        };
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

    const limit = pLimit(5); // Giới hạn 5 requests song song
    const tasks = orderIds.map(orderId => limit(() => fetchOrderData(orderId, authToken)));
    const results = await Promise.all(tasks);

    res.json(results);
});

app.listen(PORT, () => {
    console.log(`Server chạy tại http://localhost:${PORT}`);
});
