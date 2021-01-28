/**
 * Created by satadru on 3/31/17.
 */
import React, { useContext, useEffect, useRef, useState } from 'react';

import Rect from '../models/Rect';
import EPGUtils from '../utils/EPGUtils';
import CanvasUtils from '../utils/CanvasUtils';
import EPGEvent from '../models/EPGEvent';
import AppContext from '../AppContext';
import '../styles/app.css';

const DAYS_BACK_MILLIS = 2 * 60 * 60 * 1000; // 2 hours
const DAYS_FORWARD_MILLIS = 1 * 24 * 60 * 60 * 1000; // 1 days
const HOURS_IN_VIEWPORT_MILLIS = 2 * 60 * 60 * 1000; // 2 hours
const TIME_LABEL_SPACING_MILLIS = 30 * 60 * 1000; // 30 minutes

const VISIBLE_CHANNEL_COUNT = 8; // No of channel to show at a time
const VERTICAL_SCROLL_BOTTOM_PADDING_ITEM = VISIBLE_CHANNEL_COUNT / 2 - 1;
const VERTICAL_SCROLL_TOP_PADDING_ITEM = VISIBLE_CHANNEL_COUNT / 2 - 1;

const TVGuide = (props: { unmount: () => void }) => {
    const {
        locale,
        currentChannelPosition,
        epgData,
        tvhDataService,
        imageCache,
        setCurrentChannelPosition
    } = useContext(AppContext);

    const canvas = useRef<HTMLCanvasElement>(null);
    const epgWrapper = useRef<HTMLDivElement>(null);
    const programguideContents = useRef<HTMLDivElement>(null);
    const scrollAnimationId = useRef(0);

    const canvasUtils = new CanvasUtils();
    const epgUtils = new EPGUtils();

    const [timePosition, setTimePosition] = useState(epgUtils.getNow());
    const [focusedChannelPosition, setFocusedChannelPosition] = useState(currentChannelPosition);
    const [focusedEventPosition, setFocusedEventPosition] = useState(-1);
    const [focusedEvent, setFocusedEvent] = useState<EPGEvent | null>(null);

    const millisPerPixel = useRef(0);
    const timeOffset = useRef(0);
    const timeLowerBoundary = useRef(0);
    const timeUpperBoundary = useRef(0);
    const maxHorizontalScroll = useRef(0);
    const maxVerticalScroll = useRef(0);
    const scrollX = useRef(0);
    const scrollY = useRef(0);

    const mDrawingRect = new Rect();
    const mMeasuringRect = new Rect();

    const mEPGBackground = '#1e1e1e';
    const mChannelLayoutMargin = 3;
    const mChannelLayoutPadding = 10;
    const mChannelLayoutHeight = 75;
    const mChannelLayoutWidth = 120;
    const mChannelLayoutBackground = '#323232';

    const mEventLayoutBackground = '#234054';
    const mEventLayoutBackgroundCurrent = 'rgb(50,85,110)';
    const mEventLayoutBackgroundFocus = 'rgb(65,182,230)';
    const mEventLayoutTextColor = '#d6d6d6';
    const mEventLayoutTextSize = 28;
    const mEventLayoutRecordingColor = '#da0000';

    const mDetailsLayoutMargin = 5;
    const mDetailsLayoutPadding = 8;
    const mDetailsLayoutTextColor = '#d6d6d6';
    const mDetailsLayoutTitleTextSize = 30;
    const mDetailsLayoutSubTitleTextSize = 26;
    const mDetailsLayoutSubTitleTextColor = '#969696';
    const mDetailsLayoutDescriptionTextSize = 28;

    const mTimeBarHeight = 70;
    const mTimeBarTextSize = 32;
    const mTimeBarNowTextSize = 22;
    const mTimeBarLineWidth = 3;
    const mTimeBarLineColor = '#c57120';
    const mTimeBarLinePositionColor = 'rgb(65,182,230)';

    const resetBoundaries = () => {
        millisPerPixel.current = calculateMillisPerPixel();
        timeOffset.current = calculatedBaseLine();
        timeLowerBoundary.current = getTimeFrom(0);
        timeUpperBoundary.current = getTimeFrom(getWidth());
    };

    const calculateMaxHorizontalScroll = () => {
        maxHorizontalScroll.current = Math.floor(
            (DAYS_BACK_MILLIS + DAYS_FORWARD_MILLIS - HOURS_IN_VIEWPORT_MILLIS) / millisPerPixel.current
        );
    };

    const calculateMaxVerticalScroll = () => {
        const scrollTop = getTopFrom(epgData.getChannelCount() - 1) + mChannelLayoutHeight;
        maxVerticalScroll.current = scrollTop < getChannelListHeight() ? 0 : scrollTop - getChannelListHeight();
    };

    const calculateMillisPerPixel = () => {
        return HOURS_IN_VIEWPORT_MILLIS / (getWidth() - mChannelLayoutWidth - mChannelLayoutMargin);
    };

    const calculatedBaseLine = () => {
        //return LocalDateTime.now().toDateTime().minusMillis(DAYS_BACK_MILLIS).getMillis();
        return epgUtils.getNow() - DAYS_BACK_MILLIS;
    };

    const getEventPosition = (channelPosition: number, time: number) => {
        const events = epgData.getEvents(channelPosition);
        if (events !== null) {
            for (let eventPos = 0; eventPos < events.length; eventPos++) {
                const event = events[eventPos];
                if (event.getStart() <= time && event.getEnd() >= time) {
                    return eventPos;
                }
            }
        }
        return -1;
    };

    const getFirstVisibleChannelPosition = () => {
        const y = getScrollY(false);

        let position =
            Math.round((y - mChannelLayoutMargin - mTimeBarHeight) / (mChannelLayoutHeight + mChannelLayoutMargin)) + 1;

        if (position < 0) {
            position = 0;
        }

        return position;
    };

    const getLastVisibleChannelPosition = () => {
        const y = getScrollY(false);
        const screenHeight = getChannelListHeight();
        const position = Math.floor(
            (y + screenHeight - mTimeBarHeight - mChannelLayoutMargin) / (mChannelLayoutHeight + mChannelLayoutMargin)
        );

        return position + 1;
    };

    const getXFrom = (time: number) => {
        return Math.floor(
            (time - timeLowerBoundary.current) / millisPerPixel.current +
                mChannelLayoutMargin +
                mChannelLayoutWidth +
                mChannelLayoutMargin
        );
    };

    const getTopFrom = (position: number) => {
        const y = position * (mChannelLayoutHeight + mChannelLayoutMargin) + mChannelLayoutMargin + mTimeBarHeight;
        return y - getScrollY(false);
    };

    const getXPositionStart = () => {
        return getXFrom(epgUtils.getNow() - HOURS_IN_VIEWPORT_MILLIS / 2);
    };

    const getTimeFrom = (x: number) => {
        return x * millisPerPixel.current + timeOffset.current;
    };

    const shouldDrawTimeLine = (now: number) => {
        return now >= timeLowerBoundary.current && now < timeUpperBoundary.current;
    };

    const shouldDrawPastTimeOverlay = (now: number) => {
        return now >= timeLowerBoundary.current;
    };

    const isEventVisible = (start: number, end: number) => {
        return (
            (start >= timeLowerBoundary.current && start <= timeUpperBoundary.current) ||
            (end >= timeLowerBoundary.current && end <= timeUpperBoundary.current) ||
            (start <= timeLowerBoundary.current && end >= timeUpperBoundary.current)
        );
    };

    const isRTL = () => {
        return false;
    };

    const getScrollX = (neglect = true) => (neglect ? 0 : scrollX.current);

    const setScrollX = (value: number) => (scrollX.current = value);

    const getScrollY = (neglect = true) => (neglect ? 0 : scrollY.current);

    const setScrollY = (value: number) => (scrollY.current = value);

    const getWidth = () => {
        return window.innerWidth;
    };

    const getHeight = () => {
        return window.innerHeight;
    };

    const getChannelListHeight = () => {
        return mTimeBarHeight + (mChannelLayoutMargin + mChannelLayoutHeight) * VISIBLE_CHANNEL_COUNT;
    };

    const onDraw = (canvas: CanvasRenderingContext2D) => {
        if (epgData?.hasData()) {
            timeLowerBoundary.current = getTimeFrom(getScrollX(false));
            timeUpperBoundary.current = getTimeFrom(getScrollX(false) + getWidth());
            const drawingRect = mDrawingRect;
            //console.log("X:" + getScrollX());
            drawingRect.left = getScrollX();
            drawingRect.top = getScrollY();
            drawingRect.right = drawingRect.left + getWidth();
            drawingRect.bottom = drawingRect.top + getHeight();
            // clear rect
            //canvas.clearRect(0, 0, this.getWidth(), this.getChannelListHeight());
            // draw background
            // canvas.fillStyle = '#000000';
            // canvas.fillRect(drawingRect.left, drawingRect.top, drawingRect.width, drawingRect.height);
            drawBackground(canvas, drawingRect);
            drawChannelListItems(canvas, drawingRect);
            drawEvents(canvas, drawingRect);
            drawTimebar(canvas, drawingRect);
            //drawResetButton(canvas, drawingRect);
            drawTimeLine(canvas, drawingRect);
            // draw details pane
            drawDetails(canvas, drawingRect);
        }
    };

    /**
     * draw background and usee cache for future
     *
     * @param canvas
     * @param drawingRect
     */
    const drawBackground = async (canvas: CanvasRenderingContext2D, drawingRect: Rect) => {
        drawingRect.left = getScrollX();
        drawingRect.top = getScrollY();
        drawingRect.right = drawingRect.left + getWidth();
        drawingRect.bottom = drawingRect.top + getHeight();

        canvas.fillStyle = '#000000';
        canvas.fillRect(drawingRect.left, drawingRect.top, drawingRect.width, drawingRect.height);
        // channel Background
        mMeasuringRect.left = getScrollX();
        mMeasuringRect.top = getScrollY();
        mMeasuringRect.right = drawingRect.left + mChannelLayoutWidth;
        mMeasuringRect.bottom = mMeasuringRect.top + getChannelListHeight();

        //mPaint.setColor(mChannelLayoutBackground);
        canvas.fillStyle = mChannelLayoutBackground;
        canvas.fillRect(mMeasuringRect.left, mMeasuringRect.top, mMeasuringRect.width, mMeasuringRect.height);

        // events Background
        drawingRect.left = mChannelLayoutWidth + mChannelLayoutMargin;
        drawingRect.top = mTimeBarHeight + mChannelLayoutMargin;
        drawingRect.right = getWidth();
        drawingRect.bottom = getChannelListHeight();
        canvas.globalAlpha = 1.0;
        // put stroke color to transparent
        //canvas.strokeStyle = "transparent";
        canvas.strokeStyle = 'gradient';
        //mPaint.setColor(mChannelLayoutBackground);
        // canvas.fillStyle = mChannelLayoutBackground;
        // Create gradient
        const grd = canvas.createLinearGradient(
            drawingRect.left,
            drawingRect.left,
            drawingRect.right,
            drawingRect.left
        );
        // Important bit here is to use rgba()
        grd.addColorStop(0, 'rgba(35, 64, 84, 0.4)');
        grd.addColorStop(0.3, 'rgba(35, 64, 84, 0.9)');
        grd.addColorStop(0.7, 'rgba(35, 64, 84, 0.9)');
        grd.addColorStop(1, 'rgba(35, 64, 84, 0.4)');

        // Fill with gradient
        canvas.fillStyle = grd;
        canvas.fillRect(drawingRect.left, drawingRect.top, drawingRect.width, drawingRect.height);

        // draw vertical line
        canvas.beginPath();
        canvas.lineWidth = 0.5;
        canvas.strokeStyle = mEventLayoutTextColor;
        canvas.moveTo(drawingRect.left, drawingRect.top);
        canvas.lineTo(drawingRect.left, drawingRect.bottom);
        canvas.stroke();

        // timebar
        drawingRect.left = getScrollX() + mChannelLayoutWidth + mChannelLayoutMargin;
        drawingRect.top = getScrollY();
        drawingRect.right = drawingRect.left + getWidth();
        drawingRect.bottom = drawingRect.top + mTimeBarHeight;

        // Background
        canvas.fillStyle = mChannelLayoutBackground;
        canvas.fillRect(drawingRect.left, drawingRect.top, drawingRect.width, drawingRect.height);
    };

    const drawDetails = (canvas: CanvasRenderingContext2D, drawingRect: Rect) => {
        // Background
        drawingRect.left = getScrollX();
        drawingRect.top = getChannelListHeight();
        drawingRect.right = getWidth();
        drawingRect.bottom = getHeight();

        canvas.fillStyle = '#000000'; //mChannelLayoutBackground'';
        canvas.fillRect(drawingRect.left, drawingRect.top, drawingRect.width, drawingRect.height);

        // rect for logo
        drawingRect.left = getScrollX();
        drawingRect.top = getChannelListHeight();
        drawingRect.right = drawingRect.left + 300;
        drawingRect.bottom = getHeight();

        const channel = epgData.getChannel(focusedChannelPosition);
        const event = epgData.getEvent(focusedChannelPosition, focusedEventPosition);
        const imageURL = channel?.getImageURL();
        const image = imageURL && imageCache.get(imageURL);
        if (image) {
            const imageDrawingRect = getDrawingRectForChannelImage(drawingRect, image);
            canvas.drawImage(
                image,
                imageDrawingRect.left,
                imageDrawingRect.top,
                imageDrawingRect.width,
                drawingRect.height
            );
        }

        // rect for background
        drawingRect.left = drawingRect.right;
        drawingRect.top = getChannelListHeight();
        drawingRect.right = getWidth();
        drawingRect.bottom = getHeight();

        if (event !== undefined) {
            // rect event details
            drawingRect.left += mDetailsLayoutMargin;
            drawingRect.top += mDetailsLayoutTitleTextSize + mDetailsLayoutMargin;
            drawingRect.right -= mDetailsLayoutMargin;
            drawingRect.bottom -= mDetailsLayoutMargin;
            // draw title, description etc
            canvasUtils.writeText(canvas, event.getTitle(), drawingRect.left, drawingRect.top, {
                fontSize: mDetailsLayoutTitleTextSize,
                isBold: true,
                fillStyle: mDetailsLayoutTextColor
            });
            if (event.getSubTitle() !== undefined) {
                drawDetailsSubtitle(event.getSubTitle(), canvas, drawingRect);
            }
            drawDetailsTimeInfo(event, canvas, drawingRect);
            if (event.getDescription() !== undefined) {
                drawDetailsDescription(event.getDescription(), canvas, drawingRect);
            }
        }
    };

    const drawDetailsDescription = (description: string, canvas: CanvasRenderingContext2D, drawingRect: Rect) => {
        const drect = drawingRect.clone();
        drect.right = getWidth() - 10;
        drect.top += (mDetailsLayoutTitleTextSize + mDetailsLayoutPadding) * 2 + 3;
        // draw title, description etc
        canvas.font = mDetailsLayoutDescriptionTextSize + 'px Arial';
        canvas.fillStyle = mDetailsLayoutTextColor;
        canvasUtils.wrapText(canvas, description, drect.left, drect.top, drect.width, mDetailsLayoutTitleTextSize + 5);
    };

    const drawDetailsTimeInfo = (event: EPGEvent, canvas: CanvasRenderingContext2D, drawingRect: Rect) => {
        const tDrawingRect = drawingRect.clone();
        tDrawingRect.right = getWidth() - 10;
        const timeFrameText = epgUtils.toTimeFrameString(event.getStart(), event.getEnd(), locale);
        canvasUtils.writeText(canvas, timeFrameText, tDrawingRect.right, tDrawingRect.top, {
            fontSize: mDetailsLayoutTitleTextSize,
            textAlign: 'right',
            isBold: true
        });
    };

    const drawDetailsSubtitle = (subtitle: string, canvas: CanvasRenderingContext2D, drawingRect: Rect) => {
        const drect = drawingRect.clone();
        drect.top += mDetailsLayoutTitleTextSize + mDetailsLayoutPadding;
        canvasUtils.writeText(canvas, subtitle, drect.left, drect.top, {
            fontSize: mDetailsLayoutSubTitleTextSize,
            fillStyle: mDetailsLayoutSubTitleTextColor,
            isBold: true,
            maxWidth: drect.width
        });
    };

    const drawTimebar = (canvas: CanvasRenderingContext2D, drawingRect: Rect) => {
        drawingRect.left = getScrollX() + mChannelLayoutWidth + mChannelLayoutMargin;
        drawingRect.top = getScrollY();
        drawingRect.right = drawingRect.left + getWidth();
        drawingRect.bottom = drawingRect.top + mTimeBarHeight;
        // draw time stamps
        for (let i = 0; i < HOURS_IN_VIEWPORT_MILLIS / TIME_LABEL_SPACING_MILLIS; i++) {
            // Get time and round to nearest half hour
            let time =
                TIME_LABEL_SPACING_MILLIS *
                ((timeLowerBoundary.current + TIME_LABEL_SPACING_MILLIS * i + TIME_LABEL_SPACING_MILLIS / 2) /
                    TIME_LABEL_SPACING_MILLIS);
            time = epgUtils.getRoundedDate(30, new Date(time)).getTime();

            const timeText = epgUtils.toTimeString(time, locale);
            const x = getXFrom(time);
            const y = drawingRect.middle;
            canvasUtils.writeText(canvas, timeText, x, y, {
                fontSize: mEventLayoutTextSize,
                fillStyle: mEventLayoutTextColor,
                textAlign: 'center',
                isBold: true
            });
        }

        drawTimebarDayIndicator(canvas, drawingRect);
        drawTimebarBottomStroke(canvas, drawingRect);
    };

    const drawTimebarDayIndicator = (canvas: CanvasRenderingContext2D, drawingRect: Rect) => {
        drawingRect.left = getScrollX();
        drawingRect.top = getScrollY();
        drawingRect.right = drawingRect.left + mChannelLayoutWidth;
        drawingRect.bottom = drawingRect.top + mTimeBarHeight;

        // Background
        canvas.fillStyle = mChannelLayoutBackground;
        canvas.fillRect(drawingRect.left, drawingRect.top, drawingRect.width, drawingRect.height);

        // Text
        const weekdayText = epgUtils.getWeekdayName(timeLowerBoundary.current, locale);
        canvasUtils.writeText(canvas, weekdayText, drawingRect.center, drawingRect.middle, {
            fontSize: mTimeBarTextSize,
            fillStyle: mEventLayoutTextColor,
            textAlign: 'center',
            isBold: true
        });
    };

    const drawTimebarBottomStroke = (canvas: CanvasRenderingContext2D, drawingRect: Rect) => {
        drawingRect.left = getScrollX();
        drawingRect.top = getScrollY() + mTimeBarHeight;
        drawingRect.right = drawingRect.left + getWidth();
        drawingRect.bottom = drawingRect.top + mChannelLayoutMargin;

        // Bottom stroke
        //mPaint.setColor(mEPGBackground);
        canvas.fillStyle = mEPGBackground;
        canvas.fillRect(drawingRect.left, drawingRect.top, drawingRect.width, drawingRect.height);
    };

    const drawTimeLine = (canvas: CanvasRenderingContext2D, drawingRect: Rect) => {
        const now = epgUtils.getNow();

        if (shouldDrawPastTimeOverlay(now)) {
            // draw opaque overlay
            drawingRect.left = getScrollX() + mChannelLayoutWidth + mChannelLayoutMargin;
            drawingRect.top = getScrollY();
            drawingRect.right = getXFrom(now);
            drawingRect.bottom = drawingRect.top + getChannelListHeight();

            canvas.fillStyle = mTimeBarLineColor;
            const currentAlpha = canvas.globalAlpha;
            canvas.globalAlpha = 0.2;
            canvas.fillRect(drawingRect.left, drawingRect.top, drawingRect.width, drawingRect.height);
            canvas.globalAlpha = currentAlpha;
        }

        if (shouldDrawTimeLine(now)) {
            drawingRect.left = getXFrom(now);
            drawingRect.top = getScrollY();
            drawingRect.right = drawingRect.left + mTimeBarLineWidth;
            drawingRect.bottom = drawingRect.top + getChannelListHeight();

            //mPaint.setColor(mTimeBarLineColor);
            canvas.fillStyle = mTimeBarLineColor;
            //canvas.drawRect(drawingRect, mPaint);
            canvas.fillRect(drawingRect.left, drawingRect.top, drawingRect.width, drawingRect.height);
        }

        // draw current position
        drawingRect.left = getXFrom(timePosition);
        drawingRect.top = getScrollY() + mTimeBarHeight - mTimeBarTextSize + 10;
        drawingRect.right = drawingRect.left + mTimeBarLineWidth;
        drawingRect.bottom = drawingRect.top + getChannelListHeight();

        // draw now time stroke
        canvas.fillStyle = mTimeBarLinePositionColor;
        canvas.fillRect(drawingRect.left, drawingRect.top, drawingRect.width, drawingRect.height);

        // draw now time text
        drawingRect.top += mTimeBarNowTextSize / 2;
        drawingRect.left = getXFrom(timePosition) + mChannelLayoutPadding;
        const timeText = epgUtils.toTimeString(timePosition, locale);
        canvasUtils.writeText(canvas, timeText, drawingRect.left, drawingRect.top, {
            fontSize: mTimeBarNowTextSize,
            fillStyle: mTimeBarLinePositionColor,
            isBold: true
        });
    };

    const drawEvents = (canvas: CanvasRenderingContext2D, drawingRect: Rect) => {
        // Background
        drawingRect.left = mChannelLayoutWidth + mChannelLayoutMargin;
        drawingRect.top = mTimeBarHeight + mChannelLayoutMargin;
        drawingRect.right = getWidth();
        drawingRect.bottom = getChannelListHeight();

        const firstPos = getFirstVisibleChannelPosition();
        const lastPos = getLastVisibleChannelPosition();

        //console.log("Channel: First: " + firstPos + " Last: " + lastPos);
        //let transparentTop = firstPos + 3;
        //let transparentBottom = lastPos - 3;
        // canvas.globalAlpha = 0.0;
        for (let pos = firstPos; pos < lastPos; pos++) {
            // if (pos <= transparentTop) {
            //     canvas.globalAlpha += 0.25;
            // } else if (pos >= transparentBottom) {
            //     canvas.globalAlpha -= 0.25;
            // } else {
            //     canvas.globalAlpha = 1;
            // }
            // draw horizontal lines
            canvas.beginPath();
            canvas.lineWidth = 0.5;
            canvas.strokeStyle = mEventLayoutTextColor;
            canvas.moveTo(mChannelLayoutWidth + mChannelLayoutMargin, getTopFrom(pos));
            canvas.lineTo(getWidth(), getTopFrom(pos));
            canvas.stroke();

            const epgEvents = epgData.getEvents(pos);
            let wasVisible = false;
            //  the list is ordered by time so its only a few events processed
            epgEvents.forEach((event) => {
                const isVisible = isEventVisible(event.getStart(), event.getEnd());
                if (isVisible) {
                    wasVisible = true;
                    drawEvent(canvas, pos, event, drawingRect);
                }
                if (wasVisible && !isVisible) {
                    return;
                }
            });
        }
        canvas.globalAlpha = 1;
    };

    const drawEvent = (
        canvas: CanvasRenderingContext2D,
        channelPosition: number,
        event: EPGEvent,
        drawingRect: Rect
    ) => {
        setEventDrawingRectangle(channelPosition, event.getStart(), event.getEnd(), drawingRect);

        // canvas.drawRect(drawingRect, mPaint);
        // set starting minimal behind channel list
        if (drawingRect.left < getScrollX() + mChannelLayoutWidth + mChannelLayoutMargin) {
            drawingRect.left = getScrollX() + mChannelLayoutWidth + mChannelLayoutMargin;
        }

        // Background
        canvas.fillStyle = event.isCurrent() ? mEventLayoutBackgroundCurrent : mEventLayoutBackground;
        if (event.getId() === focusedEvent?.getId()) {
            canvas.fillStyle = mEventLayoutBackgroundFocus;
        }
        canvas.fillRect(drawingRect.left + 1, drawingRect.top + 1, drawingRect.width + 1, drawingRect.height + 1);

        // draw vertical line
        canvas.beginPath();
        canvas.lineWidth = 0.5;
        canvas.strokeStyle = mEventLayoutTextColor;
        canvas.moveTo(drawingRect.left, drawingRect.top + 1);
        canvas.lineTo(drawingRect.left, drawingRect.bottom + 2);
        canvas.stroke();

        if (epgData.isRecording(event)) {
            canvas.fillStyle = mEventLayoutRecordingColor;
            canvas.fillRect(drawingRect.left, drawingRect.top, drawingRect.width, 4);
        }

        // Add left and right inner padding
        drawingRect.left += mChannelLayoutPadding;
        drawingRect.right -= mChannelLayoutPadding;

        // Text
        canvasUtils.writeText(canvas, event.getTitle(), drawingRect.left, drawingRect.middle, {
            fontSize: mEventLayoutTextSize,
            fillStyle: mEventLayoutTextColor,
            maxWidth: drawingRect.width
        });
        // if (event.getSubTitle()) {
        //     canvas.font = this.mEventLayoutTextSize - 6 + "px Arial";
        //     canvas.fillText(this.canvasUtils.getShortenedText(canvas, event.getSubTitle(), drawingRect), drawingRect.left, drawingRect.top + 18);
        // }
    };

    const setEventDrawingRectangle = (channelPosition: number, start: number, end: number, drawingRect: Rect) => {
        drawingRect.left = getXFrom(start);
        drawingRect.top = getTopFrom(channelPosition);
        drawingRect.right = getXFrom(end) - mChannelLayoutMargin;
        drawingRect.bottom = drawingRect.top + mChannelLayoutHeight;
        return drawingRect;
    };

    const drawChannelListItems = (canvas: CanvasRenderingContext2D, drawingRect: Rect) => {
        // Background
        mMeasuringRect.left = getScrollX();
        mMeasuringRect.top = getScrollY();
        mMeasuringRect.right = drawingRect.left + mChannelLayoutWidth;
        mMeasuringRect.bottom = mMeasuringRect.top + getChannelListHeight();

        const firstPos = getFirstVisibleChannelPosition();
        const lastPos = getLastVisibleChannelPosition();

        //console.log("Channel: First: " + firstPos + " Last: " + lastPos);

        for (let pos = firstPos; pos < lastPos; pos++) {
            drawChannelItem(canvas, pos, drawingRect);
        }
    };

    /*
    drawChannelText(canvas, position, drawingRect) {
        drawingRect.left = getScrollX();
        drawingRect.top = getTopFrom(position);
        drawingRect.right = drawingRect.left + mChannelLayoutWidth;
        drawingRect.bottom = drawingRect.top + mChannelLayoutHeight;
 
        drawingRect.top += (((drawingRect.bottom - drawingRect.top) / 2) + (10/2));
 
        canvas.font = "bold " + mEventLayoutTextSize+"px Arial";
        let channelName = epgData.getChannel(position).getName();
        let channelNumber = epgData.getChannel(position).getId();
        //canvas.fillText(channelNumber, drawingRect.left, drawingRect.top);
        canvas.fillText(channelName, drawingRect.left + 20, drawingRect.top);
    }*/

    const drawChannelItem = (canvas: CanvasRenderingContext2D, position: number, drawingRect: Rect) => {
        drawingRect.left = getScrollX();
        drawingRect.top = getTopFrom(position);
        drawingRect.right = drawingRect.left + mChannelLayoutWidth;
        drawingRect.bottom = drawingRect.top + mChannelLayoutHeight;
        /*
                canvas.font = mEventLayoutTextSize + "px Arial";
                canvas.fillStyle = mEventLayoutTextColor;
                canvas.textAlign = 'right';
                canvas.fillText(epgData.getChannel(position).getChannelID(),
                     drawingRect.left + 60, drawingRect.top + mChannelLayoutHeight/2 + mEventLayoutTextSize/2 );
                canvas.textAlign = 'left';
                drawingRect.left += 75;
                canvas.fillText(canvasUtils.getShortenedText(canvas, epgData.getChannel(position).getName(), drawingRect),
                     drawingRect.left, drawingRect.top + mChannelLayoutHeight/2 + mEventLayoutTextSize/2 );
                */
        // Loading channel image into target for
        const channel = epgData.getChannel(position);
        const imageURL = channel?.getImageURL();
        const image = imageURL && imageCache.get(imageURL);
        if (image) {
            drawingRect = getDrawingRectForChannelImage(drawingRect, image);
            canvas.drawImage(image, drawingRect.left, drawingRect.top, drawingRect.width, drawingRect.height);
        } else {
            canvas.textAlign = 'center';
            canvas.font = 'bold 17px Arial';
            canvas.fillStyle = mEventLayoutTextColor;
            canvasUtils.wrapText(
                canvas,
                channel?.getName() || '',
                drawingRect.left + drawingRect.width / 2,
                drawingRect.top + (drawingRect.bottom - drawingRect.top) / 2,
                drawingRect.width,
                20
            );
            //canvas.fillText(this.canvasUtils.getShortenedText(canvas, channel.getName(), drawingRect), drawingRect.left + (drawingRect.width /2), drawingRect.top + 9+  (drawingRect.bottom - drawingRect.top) / 2);
            canvas.textAlign = 'left';
        }
    };

    const getDrawingRectForChannelImage = (drawingRect: Rect, image: HTMLImageElement) => {
        drawingRect.left += mChannelLayoutPadding;
        drawingRect.top += mChannelLayoutPadding;
        drawingRect.right -= mChannelLayoutPadding;
        drawingRect.bottom -= mChannelLayoutPadding;

        const imageWidth = image.width;
        const imageHeight = image.height;
        const imageRatio = imageHeight / imageWidth;

        const rectWidth = drawingRect.right - drawingRect.left;
        const rectHeight = drawingRect.bottom - drawingRect.top;

        // Keep aspect ratio.
        if (imageWidth > imageHeight) {
            const padding = Math.floor((rectHeight - rectWidth * imageRatio) / 2);
            drawingRect.top += padding;
            drawingRect.bottom -= padding;
        } else if (imageWidth <= imageHeight) {
            const padding = Math.floor((rectWidth - rectHeight / imageRatio) / 2);
            drawingRect.left += padding;
            drawingRect.right -= padding;
        }

        return drawingRect;
    };

    const recalculateAndRedraw = (withAnimation: boolean) => {
        if (epgData !== null && epgData.hasData()) {
            resetBoundaries();
            calculateMaxVerticalScroll();
            calculateMaxHorizontalScroll();

            //scrollX = this.getScrollX() + this.getXPositionStart() - this.getScrollX();
            scrollToChannelPosition(focusedChannelPosition, withAnimation);
        }
    };

    const handleKeyPress = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const keyCode = event.keyCode;
        let eventPosition = focusedEventPosition;
        let channelPosition = focusedChannelPosition;

        // do not pass this event to parents
        switch (keyCode) {
            case 39: // right arrow
                event.stopPropagation();
                eventPosition += 1;
                scrollToEventPosition(eventPosition);
                break;
            case 37: // left arrow
                event.stopPropagation();
                eventPosition -= 1;
                scrollToEventPosition(eventPosition);
                break;
            case 40: // arrow down
                event.stopPropagation();
                channelPosition += 1;
                if (channelPosition > epgData.getChannelCount() - 1) {
                    channelPosition = 0;
                }
                scrollToChannelPosition(channelPosition, false);
                return;
            case 38: // arrow up
                event.stopPropagation();
                channelPosition -= 1;
                if (channelPosition < 0) {
                    channelPosition = epgData.getChannelCount() - 1;
                }
                scrollToChannelPosition(channelPosition, false);
                return;
            case 403:
                event.stopPropagation();
                toggleRecording(channelPosition, eventPosition);
                break;
            case 461:
            case 406: // blue or back button hide epg/show tv
            case 66: // keyboard 'b'
                event.stopPropagation();
                props.unmount();
                break;
            case 13: // ok button -> switch to focused channel
                event.stopPropagation();
                props.unmount();
                setCurrentChannelPosition(channelPosition);
                break;
            default:
                console.log('EPG-keyPressed:', keyCode);
        }
    };

    const handleScrollWheel = (event: React.WheelEvent) => {
        event.stopPropagation();
        // TODO: do something useful
    };

    const handleClick = (event: React.MouseEvent) => {
        event.stopPropagation();
        // TODO: select event directly
    };

    const toggleRecording = (channelPosition: number, eventPosition: number) => {
        // red button to trigger or cancel recording
        // get current event
        const currentEvent = epgData.getEvent(channelPosition, eventPosition);
        setFocusedEvent(currentEvent);
        if (currentEvent.isPastDated(epgUtils.getNow())) {
            // past dated do nothing
            return;
        }
        // check if event is already marked for recording
        const recEvent = epgData.getRecording(currentEvent);
        if (recEvent) {
            // cancel recording
            tvhDataService?.cancelRec(recEvent, (recordings: EPGEvent[]) => {
                epgData.updateRecordings(recordings);
                updateCanvas(); // TODO is still still needed?
            });
        } else {
            // creat new recording from event
            tvhDataService?.createRec(currentEvent, (recordings: EPGEvent[]) => {
                epgData.updateRecordings(recordings);
                updateCanvas(); // TODO is still still needed?
            });
        }
    };

    const scrollToTimePosition = (timeDeltaInMillis: number) => {
        const targetTimePosition = timePosition + timeDeltaInMillis;
        setTimePosition(targetTimePosition);
        // if (targetTimePosition < this.mTimeLowerBoundary) {
        //     this.timePosition = this.mTimeLowerBoundary;
        //     return;
        // }
        // if (targetTimePosition > this.mTimeUpperBoundary) {
        //     this.timePosition = this.mTimeUpperBoundary;
        //     return;
        // }
    };

    const scrollToEventPosition = (eventPosition: number) => {
        const eventCount = epgData.getEventCount(focusedChannelPosition);

        if (eventPosition < 0) {
            eventPosition = 0;
        }

        if (eventPosition >= eventCount - 1) {
            eventPosition = eventCount - 1;
        }

        setFocusedEventPosition(eventPosition);
        const targetEvent = epgData.getEvent(focusedChannelPosition, eventPosition);
        if (targetEvent) {
            scrollToTimePosition(targetEvent.getStart() + 1 - timePosition);
        }
    };

    const scrollToChannelPosition = (channelPosition: number, withAnimation: boolean) => {
        setFocusedChannelPosition(channelPosition);

        // start scrolling after padding position top
        if (channelPosition < VERTICAL_SCROLL_TOP_PADDING_ITEM) {
            setScrollY(0);
            return;
        }

        // stop scrolling before padding position bottom
        const maxPosition = epgData.getChannelCount() - 1 - VERTICAL_SCROLL_TOP_PADDING_ITEM;
        if (channelPosition >= maxPosition) {
            // fix scroll to channel in case it is within bottom padding
            if (getScrollY() === 0) {
                setScrollY(
                    mChannelLayoutMargin * VISIBLE_CHANNEL_COUNT -
                        1 +
                        mChannelLayoutHeight * (maxPosition - VERTICAL_SCROLL_TOP_PADDING_ITEM)
                );
            }
            return;
        }

        // scroll to channel position
        const scrollTarget =
            (mChannelLayoutMargin + mChannelLayoutHeight) * (channelPosition - VERTICAL_SCROLL_TOP_PADDING_ITEM);
        if (!withAnimation) {
            setScrollY(scrollTarget);
            return;
        } else {
            const scrollDistance = scrollTarget - getScrollY();
            const scrollDelta = scrollDistance / (mChannelLayoutHeight / 5);
            cancelScrollAnimation();
            scrollAnimationId.current = requestAnimationFrame(() => {
                animateScroll(scrollDelta, scrollTarget);
            });
            //console.log("Scrolled to y=%d, position=%d", scrollY, channelPosition);
        }
    };

    const cancelScrollAnimation = () => {
        scrollAnimationId.current && cancelAnimationFrame(scrollAnimationId.current);
    };

    const animateScroll = (scrollDelta: number, scrollTarget: number) => {
        if (scrollDelta < 0 && getScrollY() <= scrollTarget) {
            //this.scrollY = scrollTarget;
            cancelScrollAnimation();
            return;
        }
        if (scrollDelta > 0 && getScrollY() >= scrollTarget) {
            //this.scrollY = scrollTarget;
            cancelScrollAnimation();
            return;
        }
        //console.log("scrolldelta=%d, scrolltarget=%d, scrollY=%d", scrollDelta, scrollTarget, this.scrollY);
        setScrollY(getScrollY() + scrollDelta);
        scrollAnimationId.current = requestAnimationFrame(() => {
            animateScroll(scrollDelta, scrollTarget);
        });
        updateCanvas();
    };

    useEffect(() => {
        recalculateAndRedraw(false);
        focusEPG();
        scrollToEventPosition(focusedEventPosition);

        return () => {
            // clear timeout in case component is unmounted
            cancelScrollAnimation();
        };
    }, []);

    const changeFocusedEvent = (isSameChannel = true) => {
        resetBoundaries();

        if (isSameChannel) {
            const targetEvent = epgData.getEvent(focusedChannelPosition, focusedEventPosition);
            targetEvent && setFocusedEvent(targetEvent);
            targetEvent && setTimePosition(targetEvent.getStart() + 1);
            targetEvent && setScrollX(getXFrom(targetEvent.getStart() + 1 - HOURS_IN_VIEWPORT_MILLIS / 2));
        } else {
            const targetEvent = epgData.getEventAtTimestamp(focusedChannelPosition, timePosition);
            setFocusedEvent(targetEvent);
        }
    };

    useEffect(() => {
        changeFocusedEvent(false);
    }, [focusedChannelPosition]);

    useEffect(() => {
        changeFocusedEvent();
    }, [focusedEventPosition]);

    useEffect(() => {
        updateCanvas();
    }, [focusedEvent, timePosition]);

    const updateCanvas = () => {
        if (canvas.current) {
            const ctx = canvas.current.getContext('2d');

            // clear
            ctx && ctx.clearRect(0, 0, getWidth(), getHeight());

            // draw child elements
            ctx && onDraw(ctx);
        }
    };

    const focusEPG = () => {
        epgWrapper.current?.focus();
    };

    return (
        <div
            id="epg-wrapper"
            ref={epgWrapper}
            tabIndex={-1}
            onKeyDown={handleKeyPress}
            onWheel={handleScrollWheel}
            onClick={handleClick}
            className="epg"
        >
            <div className="programguide-contents" ref={programguideContents}>
                <canvas ref={canvas} width={getWidth()} height={getHeight()} style={{ display: 'block' }} />
            </div>
        </div>
    );
};

export default TVGuide;
